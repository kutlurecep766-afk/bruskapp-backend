# Agent instructions

## Deploy
- MUST always use blue-green deploy: `C:\Users\Recep\projects\deploy-backend.ps1`
- NEVER use `git push` or `npm run build` alone — blue-green handles git push, Docker build, healthcheck, regression tests, and automatic rollback on failure
- After any code change that affects production, deploy via blue-green

## Marketplaces
All integrations must use official API docs verified from developer portals. Current status (all ✅):
- Trendyol: V2 API at `apigw.trendyol.com/integration`, `sellers/{sellerId}`
- Yemeksepeti: `yemeksepeti.partner.deliveryhero.io/v2`, OAuth2, chainId+vendorId
- Hepsiburada: `listing-external.hepsiburada.com` + `oms-external.hepsiburada.com`, BasicAuth + User-Agent
- Trendyol Go: `api.tgoapis.com/integrator`, BasicAuth + api-key header

## Webhook Security (CRITICAL)
- Her webhook isteğinde HMAC imzasını (X-*-Signature header) MUTLAKA doğrula
- Trendyol: HMAC-SHA256 (secret key ile), header: `X-Trendyol-Signature`
- Getir/Trendyol Go: HMAC-SHA256, header: `X-Getir-Signature`
- Hepsiburada: HMAC-SHA256, header: `X-HepsiBurada-Signature`
- n11: callback URL'e POST + imza kontrolü
- İmza geçersizse 401 dön, işleme alma

## Key paths
- Source: `C:\Users\Recep\projects\bruskapp-backend`
- Deploy script: `C:\Users\Recep\projects\deploy-backend.ps1`
- VPS: root@100.83.3.22 (SSH key: `C:\Users\Recep\.ssh\vps_key`)