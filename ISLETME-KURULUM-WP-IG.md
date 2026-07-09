# WhatsApp + Instagram İşletme Kurulum Kılavuzu

## Süre: ~1.5-2 saat / işletme (Meta onayları beklendiyse)

---

## A. META TARAFI (İlk 5-10 işletme için biz yapıyoruz)

### A1. Meta Business Hesabı
- [ ] **Meta Business Suite** hesabı aç → https://business.facebook.com
- [ ] İşletme profili oluştur (işletme adı, e-posta, bilgiler)
- [ ] İşletme sahibini **Admin** olarak ekle

### A2. WhatsApp Business API (WABA)
- [ ] Meta Business altında **WhatsApp > Başlangıç**'a git
- [ ] **WhatsApp Business Hesabı (WABA)** oluştur
- [ ] **Telefon numarası kaydet** (daha önce WhatsApp kullanılmamış numara)
  - SMS veya arama ile doğrula
  - Bu numara sadece API içindir, WhatsApp uygulamasında kullanılamaz
- [ ] **WhatsApp Yönetim Paneli**'ne gir (`https://business.facebook.com/wa/manage`)
- [ ] Sol menü **API Kurulumu** → **Başlangıç**
- [ ] **Access Token** oluştur (geçici token, permissions: `whatsapp_business_messaging`, `whatsapp_business_phone_number`)
- [ ] **Telefon Numarası ID'sini** (`phone_number_id`) not al
- [ ] **WhatsApp Business Account ID**'yi not al (`waba_id`)
- [ ] **Webhook** bölümüne gir:
  - **Callback URL**: `https://bruskapp.com/api/whatsapp/webhook`
  - **Verify Token**: işletmeye özel bir token belirle (örn. `isletmeadi_whatsapp_verify_2024`)
  - **Abone olunacak alanlar**: `messages`, `message_deliveries`, `message_reads`
  - **Doğrula** (Verify) butonuna bas → başarılı olmalı

### A3. Instagram Business Hesabı
- [ ] Instagram hesabını **Business hesaba çevir** (eğer değilse)
  - Ayarlar > Hesap > Hesap Türü > İşletme Hesabına Geç
- [ ] Meta Business Suite'te Instagram hesabını **işletmeye bağla**
  - Business Settings > Accounts > Instagram Accounts > Ekle
- [ ] **Meta Developers** paneli (`https://developers.facebook.com`) → Uygulamamız (`wpigapp-IG`)
  - Veya yeni bir uygulama oluştur (eğer yoksa)
- [ ] **Roller** kısmından işletme sahibini **Test Kullanıcısı** veya **Geliştirici** ekle
- [ ] **Erişim Belirteçleri** (Access Tokens) bölümü:
  - Token oluştur, **Instagram Business** izinlerini seç:
    - `instagram_basic`
    - `instagram_manage_messages`
    - `instagram_manage_comments`
    - `instagram_business_content_publish`
    - `instagram_business_manage_insights`
  - **Token türü**: `IGAA...` ile başlayan **Instagram Access Token** (EAA değil!)

### A4. Instagram Webhook
- [ ] Meta Developers > Uygulama > **Webhook** > **Instagram** sayfası
- [ ] **Callback URL**: `https://bruskapp.com/api/instagram/webhook`
- [ ] **Verify Token**: işletmeye özel bir token belirle (örn. `isletmeadi_ig_verify_2024`)
- [ ] Doğrula (Verify) butonuna bas
- [ ] **Abone olunan alanlar**: `messages`, `messaging_optins`, `messaging_optouts`
- [ ] Kaydet

---

## B. BRUSKAPP PANEL TARAFI (Her işletme aynı)

### B1. Tenant & Kullanıcı
- [ ] Admin panelden yeni **tenant** (işletme) oluştur
- [ ] Tenant sahibini **kullanıcı olarak ekle** + rolünü ata
- [ ] Tenant'a özel subdomain veya panel erişimini ayarla

### B2. WhatsApp Config
- [ ] Panel > **WhatsApp** sayfasına gir
- [ ] **Access Token**: Meta'dan aldığın token'ı yapıştır
- [ ] **Phone Number ID**: Meta'dan aldığın ID'yi gir
- [ ] **Webhook Token**: A2 adımında belirlediğin verify token'ı gir
- [ ] **Aktif** kutucuğunu işaretle
- [ ] **Kaydet** butonuna bas
- [ ] **Test** butonuna bas → bağlantı başarılı mı kontrol et

### B3. Instagram Config
- [ ] Panel > **Instagram** sayfasına gir
- [ ] **Erişim Tokeni**: Meta'dan aldığın `IGAA...` token'ı yapıştır
- [ ] **IG Business Account ID**: Instagram Business hesap ID'sini gir
  - (Test et butonu ile de bulunabilir)
- [ ] **Webhook Token**: A4 adımında belirlediğin verify token'ı gir
- [ ] **Aktif** işaretle
- [ ] **Kaydet** + **Test** butonuna bas

### B4. Chatbot Bilgi Havuzu
- [ ] Panel > **Chatbot Ayarları** sayfasına gir
- [ ] **İşletme Bilgileri**:
  - İşletme adı, e-posta, telefon, adres, çalışma saatleri
  - Açıklama (2-3 cümle işletmenin ne yaptığı)
  - Karşılama mesajı
  - Sistem promptu (opsiyonel)
- [ ] **Ürün / Hizmetler**: En az 5-10 ürün/hizmet ekle
- [ ] **SSS**: En az 10-15 sık sorulan soru + cevap
- [ ] **Bilgi Havuzu**: İşletme hakkında detaylı bilgi metnini yapıştır
  - Ne kadar detaylı o kadar iyi
  - Fiyat listesi, paket içerikleri, referanslar, politika vb.

### B5. Aylık Mesaj Limiti
- [ ] Panel > **Modüller** sayfası
- [ ] **AI Auto Reply** açık mı kontrol et
- [ ] **Message Limit** belirle (0 = sınırsız, Tier1 için 250 önerilir)

### B6. Webhook Doğrulama (Final)
- [ ] Meta WhatsApp panelinde **Webhook** alanına:
  - URL: `https://bruskapp.com/api/whatsapp/webhook`
  - Verify Token: WhatsApp config'de girdiğin token
  - Gönder butonuna bas → **Aktif** olduğunu gör
- [ ] Meta Instagram panelinde **Webhook**:
  - URL: `https://bruskapp.com/api/instagram/webhook`
  - Verify Token: Instagram config'de girdiğin token
  - **Aktif** olduğunu gör

---

## C. TEST AŞAMASI (Her işletme için kritik)

### C1. WhatsApp Test
- [ ] İşletme sahibinin cep telefonundan WhatsApp numarasına mesaj at
- [ ] Panel > **Mesajlar** sayfasında mesajın geldiğini gör
- [ ] AI otomatik cevap veriyor mu kontrol et
- [ ] Cevap mesajı WhatsApp'ta görünüyor mu kontrol et
- [ ] "AI'den Devral" butonu çalışıyor mu test et
- [ ] Panelden cevap yaz → gidiyor mu kontrol et

### C2. Instagram Test
- [ ] İşletmenin Instagram hesabına DM at (başka hesaptan)
- [ ] Panel > **Mesajlar** sayfasında mesajın geldiğini gör
- [ ] AI otomatik cevap veriyor mu kontrol et
- [ ] Instagram DM kutusunda cevap görünüyor mu kontrol et

### C3. Chatbot Test
- [ ] Bilgi havuzundaki verilere uygun sorular sor
- [ ] Uydurma / yanlış bilgi veriyor mu kontrol et
- [ ] SSS'lerdeki soruları test et
- [ ] Ürün fiyat sorularını test et
- [ ] İletişim bilgisi sorularını test et

---

## D. SON KONTROL

- [ ] WhatsApp webhook **Aktif** (Meta panelinde yeşil)
- [ ] Instagram webhook **Aktif**
- [ ] Mesaj alınabiliyor
- [ ] AI cevap veriyor
- [ ] AI devral/devret çalışıyor
- [ ] Aylık limit doğru ayarlanmış
- [ ] Tenant kullanıcısı panele girebiliyor
- [ ] Gizlilik politikası sayfası yayında (`https://bruskapp.com/gizlilik`)

---

## ÖNEMLİ NOTLAR

| Konu | Açıklama |
|------|----------|
| WP numarası | Daha önce WhatsApp kullanılmamış olmalı, yoksa yeni hat alın |
| IG token | `IGAA...` ile başlar, `EAA...` çalışmaz |
| IG API | `graph.instagram.com` kullanılır, `graph.facebook.com` değil |
| 24h kuralı | Kullanıcı yazmadıysa sadece onaylı şablon gönderilebilir |
| Tier sınırı | Başlangıçta ~250 kullanıcı/gün, zamanla yükselir |
| Ban riski | Marketing mesajı atma (onaysız şablon) hesabı kısıtlatır |
| Webhook URL | `https://bruskapp.com/api/whatsapp/webhook` ve `.../instagram/webhook` |
