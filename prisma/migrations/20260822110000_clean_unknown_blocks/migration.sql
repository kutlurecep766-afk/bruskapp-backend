-- Eski hatalı engeller temizlenir: 'unknown' cihaz kimliğiyle kaydedilen engeller
-- tüm cihazları etkiliyordu. Yeni sistemde sadece gerçek cihaz kimliği engellenir.
DELETE FROM "BlockedDevice" WHERE "deviceId" = 'unknown' OR "deviceId" IS NULL;
