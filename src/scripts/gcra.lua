-- GCRA (Generic Cell Rate Algorithm) rate limiter
-- KEYS[1] = rate limit key
-- ARGV[1] = limit
-- ARGV[2] = window (seconds)
-- ARGV[3] = current timestamp (milliseconds)

local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local emission_interval = (window * 1000) / limit
local burst_tolerance = window * 1000

local tat_raw = redis.call('GET', key)
local tat = tat_raw and tonumber(tat_raw) or now
local earliest = tat - burst_tolerance

if now < earliest then
    local retry_after = math.max(1, math.ceil((earliest - now) / 1000))
    local reset = math.ceil(tat / 1000)
    return {0, limit, 0, reset, retry_after}
end

local new_tat = math.max(tat, now) + emission_interval
local ttl_ms = math.ceil(burst_tolerance + emission_interval)
redis.call('SET', key, new_tat, 'PX', ttl_ms)

local remaining = math.floor((new_tat - now + burst_tolerance - emission_interval) / emission_interval)
if remaining < 0 then
    remaining = 0
end
if remaining > limit - 1 then
    remaining = limit - 1
end

local reset = math.ceil(new_tat / 1000)
return {1, limit, remaining, reset, 0}