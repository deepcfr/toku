-- KEYS = array of redis key names
-- ARGV = array of arguments
-- in lua arrays are 1 indexed so we use KEYS[1]

--[[
  KEYS[1] = rate-limit key
  ARGV[1] = current timestamp in milliseconds
  ARGV[2] = window size in milliseconds
  ARGV[3] = maximum number of requests
]]

local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

-- cutoff point
local clear_before = now - window_ms

-- clear old entries
redis.call("ZREMRANGEBYSCORE", key, "-inf", clear_before)

-- count current items inside the window
local current_requests = redis.call("ZCARD", key)

if current_requests >= limit then
	-- find out when the next req can be accepted /
	-- when the oldest req expires
	local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
	local reset_at = now + window_ms
	if oldest[2] ~= nil then
		reset_at = tonumber(oldest[2]) + window_ms
	end

	-- calculate how many seconds to retry
	local retry_after = math.max(0, math.ceil((reset_at - now) / 1000))

	-- reject req
	return {
		0,
		0,
		reset_at,
		retry_after,
	}
end

-- the req is allowed, add it
-- member must be unique so `{now}-{random number}`
local member = now .. "-" .. math.random(100000, 999999)
redis.call("ZADD", key, now, member)

-- set TTL for auto cleanup
-- TTL = window size so the key expires when the window would
redis.call("PEXPIRE", key, window_ms)

-- calculate remaining req and resetAt
local remaining = limit - (current_requests + 1)
local reset_at = now + window_ms

return {
	1,
	remaining,
	reset_at,
	0,
}
