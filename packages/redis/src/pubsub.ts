// not needed for single server setup
// but while scaling when there are multiple servers behind a loadbalancer, if A is connected on server-1 and B is connected to server-2, A sends "hi" to server-1 how would B receive it? server-1 checks its local memory and B isnt there so the message is lost!
// redis pub/sub acts as a bridge among servers
/**
 * server-1 publishes to toku:room:channel:rm_123
 * server-2 subscribes to toku:room:channel:rm_123
 * A sends message to rm_123
 * server-1 publishes the message to the channel
 * redis broadcasts that message to all the subscribers
 * server-2 pushes the message down to B's ws
 */
// TODO: implement after @toku/protocol — will publish Buffer|string from protocol encode/decode
// export function createPubSubStore() {}
