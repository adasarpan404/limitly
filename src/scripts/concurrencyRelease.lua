-- Release a concurrency slot
-- KEYS[1] = concurrency key
-- ARGV[1] = slot id

local key = KEYS[1]
local slot_id = ARGV[1]

redis.call('ZREM', key, slot_id)
return {1}