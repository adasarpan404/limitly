-- Token bucket rate limiter
-- KEYS[1] = rate limit key
-- ARGV[1] = capacity
-- ARGV[2] = refill rate (tokens per second)
-- ARGV[3] = current timestamp (milliseconds)

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1])
local last_refill = tonumber(data[2])

if tokens == nil then
    tokens = capacity
    last_refill = now
end

local elapsed = (now - last_refill) / 1000
local refill_amount = elapsed * refill_rate
tokens = math.min(capacity, tokens + refill_amount)
last_refill = now

if tokens >= 1 then
    tokens = tokens - 1
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
    local ttl = math.ceil(capacity / refill_rate) + 1
    redis.call('EXPIRE', key, ttl)
    local remaining = math.floor(tokens)
    local reset = math.ceil(now / 1000) + math.ceil((capacity - tokens) / refill_rate)
    return {1, capacity, remaining, reset, 0}
else
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
    local ttl = math.ceil(capacity / refill_rate) + 1
    redis.call('EXPIRE', key, ttl)
    local retry_after = math.max(1, math.ceil((1 - tokens) / refill_rate))
    local reset = math.ceil(now / 1000) + retry_after
    return {0, capacity, 0, reset, retry_after}
end