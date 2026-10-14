**Bản tiếng Việt** | [English](README.md)

# Cloudflare Workers — Status Page

Giám sát website/API của bạn bằng một trang trạng thái serverless nhanh gọn. Các lượt kiểm tra chạy theo lịch qua Cron Triggers, lịch sử lưu trong KV, còn giao diện là một trang tĩnh không phụ thuộc thư viện nào, theo ngôn ngữ thiết kế của
[UptimeFlare](https://github.com/lyc8503/UptimeFlare).

**Live demo:** https://nextdns.jeremienguyen.workers.dev

## Tính năng

- **Dải thanh uptime 90 ngày** cho mỗi monitor (bậc màu kiểu UptimeFlare; ngày xám = chưa có dữ liệu và không hiện tooltip — lịch sử tích lũy dần theo thời gian, không bịa số liệu)
- **Biểu đồ latency 12h trong ngày** cho mỗi monitor (đường mượt 2px, trục giờ, tooltip đen khi rê chuột, khoảng trống khi check lỗi); **cảnh báo ngưỡng latency** cho từng monitor — pill cam "High latency" kèm đường ngưỡng đứt nét khi median gần đây vượt quá `latencyThresholdMs` đã cấu hình
- **Tab Ping** (`#ping`): một cú nhấp đo RTT trực tiếp từ trình duyệt của khách tới mọi POP (kiểu ping.nextdns.io), xếp từ nhanh nhất trước; tự chạy khi mở tab lần đầu. (Đã thử nghiệm mục kiểm tra trạng thái NextDNS kiểu test.nextdns.io nhưng đang tạm cách ly — không ổn định trên mạng của chủ sở hữu.)
- **Tab Speedtest** (`#speedtest`): tự host, đo ping/download/upload (kiểu vietcdn.net) tới Cloudflare edge — file test ngẫu nhiên 20&nbsp;MB, 4 luồng song song, cửa sổ 10s với 1s warmup grace; không dùng băng thông của bên thứ ba. Thêm mục **detailed test** đo 8 server thật của vietcdn.net (file 10&nbsp;GiB của Real-Debrid) cộng hàng Cloudflare edge — từng server chạy lượt single-connection rồi lượt 6-connection, các hàng hiện dần như vietcdn, có nút Stop và thanh tiến trình từng server
- **Tab DNS Tools** (`#dns`): **DNS Lookup** — tra cứu mọi loại bản ghi của mọi domain qua hạ tầng dnscheck.tools (addr.tools), tự động chuyển sang Cloudflare DNS-over-HTTPS khi cần (đổi được thứ tự provider); **DNS Leak Test** — mô phỏng dnscheck.tools: địa chỉ IP của bạn kèm registrant RDAP và geolocation ("(show more)" cho IP mở rộng), các pill trạng thái trực tiếp (RTT, IPv6, ADoX, EDNS, DNSSEC), ma trận kiểm tra DNSSEC đầy đủ (Invalid/Expired/Missing × 4 thuật toán ký), resolver gom theo registrant kèm subnet ECS, thanh trạng thái dưới cùng với bộ đếm truy vấn `dns:` trực tiếp (ECH hiện n/a — không đọc được cross-origin), tất cả dùng WebSocket + quan sát nameserver của họ
- **Nhóm monitor** (accordion, vd 🇻🇳 Vietnam / 🌏 International) kèm số đếm "X/Y Operational" từng nhóm; trạng thái thu gọn/mở được nhớ trong localStorage
- **Trang Incidents** (`#incidents`) với pager theo tháng (giới hạn trong cửa sổ dữ liệu KV — không lật tới tháng đã mất dữ liệu), bộ lọc monitor, và **khung giờ bảo trì định kỳ** (`maintenances:` trong `config.yaml`)
- **Ticker trực tiếp**: phần hero hiển thị "Last updated on … (GMT+7) (N sec ago)" với N nhảy mỗi giây; trang tự tải lại khi dữ liệu quá cũ
- **Overall %** tính theo trọng số thời gian (toán kiểu UptimeFlare); nhấp vào thanh để xem chi tiết incident (downtime ước tính, số đợt sự cố, thời gian phản hồi trung bình, theo từng vị trí)
- Dark mode (mặc định theo OS; chuyển tay auto → light → dark), bộ lọc tìm kiếm, layout responsive (dải thanh ẩn trên màn hình nhỏ như bản tham chiếu)
- Thông báo Slack / Telegram / Discord khi trạng thái đổi (tùy chọn, qua Worker secrets)
- Không cần server riêng, không cần bước build frontend — chỉ Cloudflare Workers + KV

Lịch sử đầy đủ: [CHANGELOG.md](CHANGELOG.md).

## Cách hoạt động

- Cron Trigger kiểm tra các monitor mỗi 10 phút (`crons` trong `wrangler.toml`); kết quả lưu trong KV dưới key `monitors_data_v1_1` — **lịch sử không mất khi redeploy hay nâng cấp**
- `config.yaml` là nguồn chân lý duy nhất cho monitor và các đoạn text
- Dọn dữ liệu cũ (monitor đã xóa khỏi config, ngày quá `daysInHistogram`) chạy ngay trong Worker — không cần script sau deploy
- Thân thiện với gói free: ~144 lượt ghi KV/ngày ở chu kỳ mặc định 10 phút, dưới xa quota 1.000/ngày; 90 ngày lịch sử theo ngày cho mỗi monitor

## Những thay đổi trong đợt viết lại 2026

- **Gỡ Flareact** (ngừng phát triển từ 2021, không tương thích wrangler hiện đại) → frontend tĩnh không phụ thuộc thư viện (HTML/CSS/JS thuần)
- **Viết lại Worker** sang modules format (`src/index.js`: `fetch` + `scheduled`)
- Cấu hình **wrangler v4**: Workers Static Assets, `kv_namespaces`, cron triggers
- **Quy trình deploy dựng lại**: Node 22, gọi trực tiếp wrangler CLI, namespace KV tự tạo/tái dùng qua API; chạy khi push lên `main` hoặc chạy tay
- Frontend restyle theo UptimeFlare (dải thanh, nhóm, trang incidents, ticker trực tiếp); toán uptime tính theo trọng số thời gian như bản tham chiếu
- Cập nhật dependencies; đã loại các package `node-fetch`/`postcss` đời cũ có lỗ hổng

## Deploy bằng GitHub Actions (khuyên dùng)

1. Clone repo này (hoặc dùng làm template).
2. **Settings → Secrets and variables → Actions**, thêm:
   - `CF_API_TOKEN` — token có quyền `Edit Cloudflare Workers`
   - `CF_ACCOUNT_ID` — ID tài khoản Cloudflare của bạn
   - _(tùy chọn)_ `SECRET_SLACK_WEBHOOK_URL`
   - _(tùy chọn)_ `SECRET_TELEGRAM_API_TOKEN` + `SECRET_TELEGRAM_CHAT_ID`
   - _(tùy chọn)_ `SECRET_DISCORD_WEBHOOK_URL`
3. Sửa [`config.yaml`](./config.yaml):

   ```yaml
   monitors:
     - id: my-site # unique identifier
       name: example.com
       description: 'My website' # tooltip, optional
       url: 'https://example.com/' # URL to fetch
       method: GET # default=GET
       expectStatus: 200 # default=200
       followRedirect: false # default=false
       linkable: true # title as link, default=true
   ```

4. Push lên `main` (hoặc chạy tay workflow **Deploy**).
5. _(tùy chọn)_ Gán custom domain trong
   [Cloudflare dashboard](https://dash.cloudflare.com/?to=/workers).

## Thông báo Telegram

1. [Tạo bot](https://core.telegram.org/bots#creating-a-new-bot) →
   `SECRET_TELEGRAM_API_TOKEN`.
2. Gửi một tin nhắn bất kỳ cho bot.
3. `curl https://api.telegram.org/bot<TOKEN>/getUpdates` →
   `.result[0].message.chat.id` → `SECRET_TELEGRAM_CHAT_ID`.
4. Deploy lại.

## Chạy local

Yêu cầu: Node 22+, tài khoản Cloudflare.

```bash
npm install
npm run dev        # builds config, starts wrangler dev with local KV
```

Mở http://localhost:8787. Kích hoạt một lượt check thủ công:
`curl http://localhost:8787/api/trigger`.

## Deploy thủ công (không dùng GitHub Actions)

```bash
npm install
wrangler login
wrangler kv namespace create KV_STATUS_PAGE   # copy the id into wrangler.toml
wrangler secret put SECRET_SLACK_WEBHOOK_URL  # repeat for other secrets (optional)
npm run deploy
```

## Lưu ý

- Key KV giữ nguyên qua các đợt viết lại, nên deploy đè lên namespace hiện có vẫn giữ toàn bộ lịch sử. Không trộn file cũ và mới.
- Gói free: quota KV đủ cho chu kỳ mặc định 10 phút (~144 lượt ghi/ngày); đổi `crons` trong `wrangler.toml` để check dày/thưa hơn.
- Tối đa ~25 monitor nếu bật thông báo Slack (giới hạn subrequest của Cloudflare).

## Ghi nhận

- Dự án gốc: [eidam/cf-workers-status-page](https://github.com/eidam/cf-workers-status-page)
  (qua [yue374/cf-workers-status-page](https://github.com/yue374/cf-workers-status-page),
  repo này được fork từ đó). Lịch sử git đã khởi động lại vào tháng 10/2026 từ đợt viết lại toàn bộ, nhưng ý tưởng và công sức ban đầu thuộc về các tác giả upstream — xin cảm ơn.
- Ngôn ngữ thiết kế UI/UX lấy cảm hứng từ [lyc8503/UptimeFlare](https://github.com/lyc8503/UptimeFlare).
- **DNS Leak Test & DNS Lookup** dùng hạ tầng [dnscheck.tools](https://dnscheck.tools)
  ([brianshea2/addr.tools](https://github.com/brianshea2/addr.tools), AGPL-3.0)
  — bài leak test mô phỏng logic và hành vi của họ; cảm ơn đã giữ các endpoint mở CORS.
- **Detailed speedtest** dùng 8 server test và file test của [vietcdn.net](https://vietcdn.net),
  host bởi Real-Debrid — xin cảm ơn.
- **Tab Ping** lấy cảm hứng từ [ping.nextdns.io](https://ping.nextdns.io); mục kiểm tra
  trạng thái NextDNS (đang tạm cách ly) dùng kỹ thuật của
  [test.nextdns.io](https://test.nextdns.io) — cảm ơn NextDNS.

## Giấy phép

MIT — xem [LICENSE](./LICENSE).
