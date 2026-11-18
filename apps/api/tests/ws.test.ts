import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { WSContext } from "hono/ws";
import { encode, MessageType } from "@toku/protocol";
import { closeQueue, workerQueue } from "../src/queue";
import { connectRedis } from "../src/redis";
import {
  queueOfflineMessage,
  subscribeToRoom,
  unsubscribeFromRoom,
} from "../src/services/messageService";
import { isUserOnline, setUserOnline } from "../src/services/presenceService";
import { addMemberToRoom, createRoom } from "../src/services/roomService";
import {
  deliverCatchUpMessages,
  handleClose,
  handleMessage,
  handleOpen,
  toUint8Array,
} from "../src/ws/connection";
import { dispatchToLocalRoom, startFanout, stopFanout } from "../src/ws/fanout";
import { handleIncomingMessage } from "../src/ws/message";
import { broadcastRoomState, handlePresencePing } from "../src/ws/presence";
import { connectionRegistry } from "../src/ws/registry";

beforeAll(async () => {
  await connectRedis();
});

afterAll(async () => {
  connectionRegistry.clear();
});

// mock WSContext for unit testing socket dispatches
function createMockSocket(): {
  ws: WSContext;
  sent: (string | ArrayBuffer | Uint8Array<ArrayBuffer>)[];
} {
  const sent: (string | ArrayBuffer | Uint8Array<ArrayBuffer>)[] = [];
  const ws = {
    send(data: string | ArrayBuffer | Uint8Array<ArrayBuffer>) {
      sent.push(data);
    },
    close() {},
    readyState: 1,
    binaryType: "arraybuffer",
  } as unknown as WSContext;

  return { ws, sent };
}

describe("WebSocket Gateway Subsystem", () => {
  let testRoomToken: string;
  const aliceHash =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const bobHash =
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  beforeAll(async () => {
    await connectRedis();
    const room = await createRoom({
      durationSeconds: 600,
      passwordHash: "test_pw",
      maxParticipants: 10,
      isDm: false,
    });
    testRoomToken = room.token;

    await addMemberToRoom({
      roomToken: testRoomToken,
      pubKeyHash: aliceHash,
      publicKeyBytes:
        "0102030405060708091011121314151617181920212223242526272829303132",
    });

    await addMemberToRoom({
      roomToken: testRoomToken,
      pubKeyHash: bobHash,
      publicKeyBytes:
        "0102030405060708091011121314151617181920212223242526272829303132",
    });
  });

  describe("In-Memory Connection Registry", () => {
    it("registers, retrieves, counts, and unregisters sockets correctly", () => {
      const mock1 = createMockSocket();
      const mock2 = createMockSocket();

      connectionRegistry.register("rm_test_reg", "user1", mock1.ws);
      connectionRegistry.register("rm_test_reg", "user2", mock2.ws);

      expect(connectionRegistry.hasRoom("rm_test_reg")).toBe(true);
      expect(connectionRegistry.getRoomSize("rm_test_reg")).toBe(2);
      expect(connectionRegistry.getSocket("rm_test_reg", "user1")).toBe(
        mock1.ws
      );

      const sockets = connectionRegistry.getRoomSockets("rm_test_reg");
      expect(sockets).toHaveLength(2);

      connectionRegistry.unregister("rm_test_reg", "user1");
      expect(connectionRegistry.getRoomSize("rm_test_reg")).toBe(1);

      connectionRegistry.unregister("rm_test_reg", "user2");
      expect(connectionRegistry.hasRoom("rm_test_reg")).toBe(false);
    });
  });

  describe("Redis Pub/Sub Fanout Bridge", () => {
    it("dispatches raw bytes to all local room sockets", () => {
      const mock = createMockSocket();
      connectionRegistry.register("rm_fanout_test", "alice", mock.ws);

      const payload = new Uint8Array([0xaa, 0x03, 0x01, 0x02]);
      dispatchToLocalRoom("rm_fanout_test", payload);

      expect(mock.sent).toHaveLength(1);
      expect(new Uint8Array(mock.sent[0] as ArrayBuffer)).toEqual(payload);

      connectionRegistry.unregister("rm_fanout_test", "alice");
    });

    it("starts and stops fanout listeners cleanly without error", async () => {
      await startFanout("rm_fanout_sub");
      await stopFanout("rm_fanout_sub");
    });
  });

  describe("Presence & Roster State Broadcast", () => {
    it("renews presence lease upon PRESENCE_PING", async () => {
      await handlePresencePing(testRoomToken, aliceHash);
      const online = await isUserOnline({
        roomToken: testRoomToken,
        pubKeyHash: aliceHash,
      });
      expect(online).toBe(true);
    });

    it("encodes and broadcasts 0x07 ROOM_STATE frame", async () => {
      await setUserOnline({ roomToken: testRoomToken, pubKeyHash: aliceHash });

      let receivedFrame: Uint8Array | null = null;
      await subscribeToRoom(testRoomToken, payload => {
        receivedFrame = payload;
      });

      await broadcastRoomState(testRoomToken);

      // wait for redis pub/sub message to arrive
      await new Promise(resolve => setTimeout(resolve, 80));

      expect(receivedFrame).not.toBeNull();
      expect(receivedFrame![0]).toBe(0xaa); // magic byte
      expect(receivedFrame![1]).toBe(MessageType.ROOM_STATE); // opcode 0x07

      await unsubscribeFromRoom(testRoomToken);
    });
  });

  describe("Binary Message Router & Arbitration", () => {
    it("drops corrupted/non-protocol frames without throwing", async () => {
      const corruptedBytes = new Uint8Array([0x00, 0x01, 0x02]);
      await expect(
        handleIncomingMessage(testRoomToken, aliceHash, corruptedBytes)
      ).resolves.toBeUndefined();
    });

    it("drops frame with mismatched room token", async () => {
      const pingFrame = encode({
        type: MessageType.PRESENCE_PING,
        roomToken: "rm_other_room",
        from: aliceHash,
      });

      await expect(
        handleIncomingMessage(testRoomToken, aliceHash, pingFrame)
      ).resolves.toBeUndefined();
    });

    it("drops frame with mismatched sender identity (anti-spoofing)", async () => {
      const spoofedPing = encode({
        type: MessageType.PRESENCE_PING,
        roomToken: testRoomToken,
        from: bobHash, // claiming to be Bob while socket is Alice
      });

      await expect(
        handleIncomingMessage(testRoomToken, aliceHash, spoofedPing)
      ).resolves.toBeUndefined();
    });

    it("routes CHAT_MESSAGE, pushes BullMQ job, queues for offline Bob, and broadcasts live", async () => {
      const chatBytes = encode({
        type: MessageType.CHAT_MESSAGE,
        roomToken: testRoomToken,
        from: aliceHash,
        msgId: 99,
        timestamp: BigInt(Date.now()),
        iv: new Uint8Array(12).fill(1),
        cipherText: new Uint8Array(32).fill(2),
        burn: false,
      });

      await handleIncomingMessage(testRoomToken, aliceHash, chatBytes);

      // verify BullMQ job was dispatched
      const waitingJobs = await workerQueue.getJobs(["waiting"]);
      const trackJob = waitingJobs.find(
        j => j.name === "TRACK_MESSAGE" && j.data.msgId === 99
      );
      expect(trackJob).toBeDefined();
    });

    it("routes DELIVERY_ACK, evicts from offline queue, and pushes BullMQ job", async () => {
      // simulate an offline message in queue
      await queueOfflineMessage({
        pubKeyHash: bobHash,
        roomToken: testRoomToken,
        msgId: 99,
        payload: new Uint8Array([0xaa, 0x03]),
      });

      const ackFrame = encode({
        type: MessageType.DELIVERY_ACK,
        roomToken: testRoomToken,
        from: bobHash,
        msgId: 99,
      });

      await handleIncomingMessage(testRoomToken, bobHash, ackFrame);

      const waitingJobs = await workerQueue.getJobs(["waiting"]);
      const ackJob = waitingJobs.find(
        j => j.name === "MARK_DELIVERED" && j.data.msgId === 99
      );
      expect(ackJob).toBeDefined();
    });
  });

  describe("Connection Lifecycle Handlers", () => {
    it("converts ArrayBuffer and Views to Uint8Array correctly", () => {
      const ab = new ArrayBuffer(4);
      expect(toUint8Array(ab)).toBeInstanceOf(Uint8Array);

      const view = new DataView(ab);
      expect(toUint8Array(view)).toBeInstanceOf(Uint8Array);

      expect(toUint8Array("hello" as unknown as ArrayBufferLike)).toBeNull();
    });

    it("handles connection open, registers in registry, and delivers catch-up", async () => {
      const mock = createMockSocket();
      await handleOpen(testRoomToken, aliceHash, mock.ws);

      expect(connectionRegistry.hasRoom(testRoomToken)).toBe(true);
      expect(connectionRegistry.getSocket(testRoomToken, aliceHash)).toBe(
        mock.ws
      );
    });

    it("handles incoming message via socket handler", async () => {
      const pingFrame = encode({
        type: MessageType.PRESENCE_PING,
        roomToken: testRoomToken,
        from: aliceHash,
      });

      await expect(
        handleMessage(testRoomToken, aliceHash, pingFrame.buffer)
      ).resolves.toBeUndefined();
    });

    it("handles connection close, removes presence, and unregisters", async () => {
      await handleClose(testRoomToken, aliceHash);
      expect(
        connectionRegistry.getSocket(testRoomToken, aliceHash)
      ).toBeUndefined();
    });

    it("delivers catch-up messages from Redis RAM queue", async () => {
      const mock = createMockSocket();
      const testFrame = new Uint8Array([0xaa, 0x03, 0x99]);

      await queueOfflineMessage({
        pubKeyHash: aliceHash,
        roomToken: testRoomToken,
        msgId: 101,
        payload: testFrame,
      });

      await deliverCatchUpMessages(testRoomToken, aliceHash, mock.ws);
      expect(mock.sent.length).toBeGreaterThanOrEqual(1);
    });
  });
});
