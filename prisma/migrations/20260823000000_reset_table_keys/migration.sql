-- Masa gizli anahtarları sıfırlanır: mevcut masaların eski QR URL'leri korunur.
-- Bundan sonra YALNIZCA yeni eklenen masalara updateConfig üzerinden anahtar üretilir.
UPDATE "Tenant"
SET "storefrontConfig" = jsonb_set(
    COALESCE("storefrontConfig"::jsonb, '{}'::jsonb),
    '{tableKeys}',
    '{}'::jsonb
)
WHERE "storefrontConfig" IS NOT NULL
  AND "storefrontConfig"::jsonb ? 'tableKeys';
