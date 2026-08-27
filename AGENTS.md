# Bruskapp - Proje Kuralları

## Başlangıç
Yeni oturum/model başlangıcında MUTLAKA şu dosyayı oku ve kurallarına uy:
`C:\Users\Recep\OneDrive\Masaüstü\yapılması zorunlu şeyler\blue-green-deploy-kurali.txt`

## Repolar
- frontend: `C:\Users\Recep\OneDrive\Masaüstü\bruskapp-frontend`
- backend:  `C:\Users\Recep\OneDrive\Masaüstü\bruskapp-backend`
- admin:    `C:\Users\Recep\OneDrive\Masaüstü\bruskapp-admin`
- GitHub: `kutlurecep766-afk/bruskapp-{frontend,backend,admin}` (main)

## Özet kurallar
- Deploy: `ssh tailscale "bash /opt/deploy.sh <backend|frontend|admin>"` — elle müdahale yok, onay şart.
- Commit öncesi `npx tsc --noEmit` temiz; `tsconfig.tsbuildinfo` commit'e girmez.
- Commit kısa Türkçe; "sadece cevap ver" gelirse işlem yapma.
- Kuralların tamamı için yukarıdaki kural dosyasına bak.
