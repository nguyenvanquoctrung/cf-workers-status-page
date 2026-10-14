**Bản tiếng Việt** | [English](CHANGELOG.md)

# Nhật ký thay đổi

Mọi thay đổi đáng chú ý của dự án được ghi lại ở đây. Ngày giờ theo
múi giờ Asia/Saigon (GMT+7).

## 2026-10-14 21:00 — Phase 12: Công cụ mạng QUIC / TLS / WebRTC

- **Kiểm tra QUIC / HTTP3**: kiểm tra trình duyệt có tới được trang qua QUIC
  không — kết hợp giao thức tải trang phía client
  (`performance.nextHopProtocol`) với 2 lần đo phía server tới endpoint mới
  `/api/conn` (nâng cấp Alt-Svc cần một round trip).
- **Thông tin kết nối TLS**: phiên bản TLS, bộ mã hóa, giao thức HTTP, vị
  trí edge, IP và nhà mạng của client theo Cloudflare edge quan sát
  (`request.cf`), qua `/api/conn` — không KV, không secret.
- **Kiểm tra rò rỉ WebRTC**: thu thập ICE candidates qua STUN
  (stun.l.google.com:19302), hiện IP công cộng (srflx) và IP nội bộ (host),
  ghi chú về mDNS obfuscation.
- Tab đổi tên **DNS Tools → Công cụ mạng** (giữ hash `#dns`).
- i18n VI/EN đầy đủ cho mọi chuỗi mới (22 key × 2).

## 2026-10-14 20:45 — Bổ sung key i18n còn thiếu

- Thêm 4 key bị hiện literal text: `speedtest.testing`,
  `speedtest.testAgain` ("Đo lại"), `ping.measuring`, `ping.progress`.
  Audit key đầy đủ: 108 key dùng = 108 key trong từ điển.

## 2026-10-14 20:20 — Sửa lỗi & tinh chỉnh

- **Trục giờ biểu đồ latency dùng 24 giờ** ("15", "16"…) thay vì AM/PM.
- **Xóa `/api/trigger` public** — ai cũng gọi được để ép chạy full check,
  đốt quota KV write; giờ chỉ còn cron kích hoạt.
- **Giới hạn body `/speedtest/upload` ở 64MB** (quá thì 413) để POST khổng lồ
  không đốt CPU/memory của Worker.
- **Fix từ review**: `renderDnsTools` không xóa leak test đang chạy khi
  chuyển tab; chart bỏ điểm không hợp lệ thay vì NaN; `<html lang="vi">`;
  logo không nháy icon ảnh vỡ; auto-reload bỏ qua khi user đang lọc.

## 2026-10-14 19:30–20:15 — Phase 11: Giao diện Việt/Anh

- **Chuyển đổi ngôn ngữ VI/EN đầy đủ** (nút `#langBtn` trên header, lưu qua
  localStorage, mặc định tiếng Việt): 111 chuỗi × 2 ngôn ngữ, bao phủ nav,
  hero, biểu đồ, sự cố, ping, speedtest, tra cứu DNS, leak test, ma trận
  DNSSEC, thẻ bảo trì, tooltip, lỗi và trạng thái trống.
- **Ngày/giờ/số theo locale** (`vi-VN` vs `en-US`, múi giờ vẫn Asia/Saigon)
  cho tooltip, nhãn ngày, pager tháng và ticker "N giây trước".
- **Đổi ngôn ngữ không xóa bài đo**: status/incidents render lại toàn bộ;
  ping/speedtest/dns cập nhật text tại chỗ qua `data-i18n-key` (nút nhớ key
  theo state), nên bài đo đang chạy và kết quả được giữ nguyên.

## 2026-10-14 19:35 — Sửa lỗi: biểu đồ latency bỏ sót điểm mới

- **Biểu đồ latency 12 giờ chỉ vẽ cụm điểm cũ nhất** (chart trông như "chết"
  sau ~4PM): heuristic ngắt đoạn dùng 1,8× *trung vị* khoảng cách giữa các lần
  đo, nhưng khoảng cách này không đồng đều từ khi cron đổi 2-phút → 10-phút —
  mọi điểm 10-phút thành đoạn lẻ 1 điểm, mà đoạn 1 điểm thì không bao giờ được
  vẽ. Giờ dùng 1,8× *p90* (tối thiểu 25 phút), và điểm lẻ hợp lệ được vẽ thành
  chấm tròn thay vì bị bỏ. Gap thật (check fail) vẫn đứt nét.

## 2026-10-14 18:45–19:01 — Phase 10: Ping tab (`960be8f`, `43fc8ea`, `3138663`, `dd84210`)

- Thẻ **"Latency from your browser" trở thành tab Ping riêng** (`#ping`,
  nav: Status | Incidents | Ping | Speedtest | DNS Tools) — vẫn đo độ trễ từ
  trình duyệt tới POP bằng một cú bấm, giờ có view riêng.
- **Tự chạy khi mở tab lần đầu** (như ping.nextdns.io); nút "Measure now" để
  đo lại thủ công; kết quả giữ nguyên khi chuyển tab hay reload (bấm nav giờ
  set hash `#ping` — trước đây rơi vào `#`, reload là mất tab).
- **Mặc định nhóm monitor: Vietnam mở sẵn, International thu gọn**
  (trước đây: tất cả thu gọn); localStorage vẫn nhớ lựa chọn thủ công.
- Thẻ **"NextDNS status"** kiểu test.nextdns.io đã được thử nghiệm (kỹ thuật
  subdomain ngẫu nhiên, định dạng lại theo thiết kế của trang, "Powered by
  test.nextdns.io") rồi **tạm cách ly** (`NX_STATUS_ENABLED = false`): verdict
  không bao giờ về tới mạng của chủ sở hữu (QA từ trình duyệt test vẫn đạt).

## 2026-10-14 18:19–18:40 — Phase 9c: leak test full info parity (`f478290`)

- **Sửa probe DNSSEC (trước hỏng, giờ chạy được):** kỹ thuật `<link
  rel=stylesheet>` onload/onerror ở 9b không bao giờ kích hoạt — trình duyệt
  kiểm tra MIME của stylesheet trong khi các domain test trả về
  `Content-Type: text/plain`. Thay bằng
  `fetch(url, {mode: 'no-cors', cache: 'no-store'})`: resolve (opaque) =
  connected, reject = blocked — port 1:1 chính xác tín hiệu `fetch().ok`
  first-party của bản gốc. Áp dụng cho probe hiệu chuẩn và mọi probe ma trận;
  giữ nguyên fallback "untestable" trung thực cho mạng bị chặn thật.
- **Ngang bằng thông tin với dnscheck.tools:** "Your IP addresses" giờ hiển thị
  **registrant RDAP** phía trên mỗi IP và **geolocation "City, Region, CC"**
  bên cạnh (registrant qua IANA RDAP bootstrap + RDAP từng RIR, CORS-open;
  geo qua `ip.addr.tools`); các IP WebRTC mở rộng ẩn sau **"(show more)"**.
- **"Your DNS resolvers"** gom nhóm theo registrant (như bản gốc), mỗi hàng có
  reverse DNS, geolocation, protocol và số query; các subnet ECS giữ dòng tóm
  tắt riêng.
- Thanh **status bar** mới ở cuối trang, phỏng theo bản gốc: các chỉ báo
  `{rtt}ms IPv6 EDNS DNSSEC ECH` + bộ đếm query **`dns: N`** trực tiếp.
  **ECH** hiển thị `n/a` kèm tooltip — `X-ECH-Status` chỉ expose cho chính
  dnscheck.tools, không bao giờ cross-origin (hiển thị trung thực, không bịa).
- Dòng attribution giữ trung thực: "Like this tool? Star us on GitHub" →
  `brianshea2/addr.tools`.
- **Tinh chỉnh sau phát hành** (`fb97190`, `f830a04`, `a023236`, `87e8035`,
  `d3b67be`, `59da851`): hiệu chuẩn DNSSEC giờ probe `{id}.test-alg15`
  (IP thật) thay vì `a.{id}-nullip` (`0.0.0.0` theo thiết kế); nút "(show more)"
  hoạt động trước/trong/sau bài test (state tách khỏi run state); luồng xin
  quyền microphone trên "(show more)" (RFC 8828) như bản gốc; IP nội bộ gắn
  nhãn "Reserved"; xóa caption DNSSEC trùng và dòng quảng cáo GitHub; subtitle
  chỉ còn credit ở mọi nơi.

## 2026-10-14 17:33–18:13 — Thay đổi nhỏ

- **18:13** — Sửa: trang tự reload làm hỏng bài đo (`0f94d5f`): `tickHero()` reload khi dữ liệu cũ hơn 300s (tàn dư từ thời cron 2 phút); với cron 10 phút gây vòng lặp reload giữa chừng bài đo. Giờ chỉ reload khi quá 1800s, không bao giờ reload giữa bài test.
- **17:45** — Deep-link bằng hash giữa session (`5f2fb62`): đổi hash trên URL (`#incidents` / `#speedtest`) chuyển view qua listener `hashchange` (trước đây chỉ có tác dụng lúc tải trang).
- **17:33** — Nhóm thu gọn mặc định (`2389253`): các nhóm monitor khởi đầu ở trạng thái thu gọn (bấm để mở), lựa chọn được nhớ trong localStorage. *Đã bị thay thế bởi Phase 10 (Vietnam mở sẵn / International thu gọn).*
## 2026-10-14 18:09 — Phase 9b: leak test mirrors dnscheck.tools (`64bbe41` pt.2)

- Thẻ **DNS Leak Test** làm lại theo yêu cầu của Jeremie là "giống bản gốc hết
  mức có thể": logic port từ `brianshea2/addr.tools`
  `website/dnscheck.tools/main.js`.
- Mục **"Your IP addresses"** mới: `myipv4`/`myipv6.addr.tools/plain` cộng thêm
  WebRTC ICE candidates qua STUN theo kiểu best-effort (không hỏi quyền mic).
- Ma trận **DNSSEC Validation Tests** mới (Invalid/Expired/Missing × ECDSA
  P-256, ECDSA P-384, Ed25519, ML-DSA-44) với ngữ nghĩa pass/fail đúng như bản
  gốc: mỗi thuật toán probe domain chữ ký hợp lệ trước, rồi tới các biến thể
  badsig/expiredsig/nosig — biến thể xấu mà connected = FAIL (đỏ), bị chặn =
  PASS (xanh), ML-DSA-44 FAIL* vàng kèm chú thích, domain hợp lệ lỗi = cột
  ERR. Cross-origin, tín hiệu "connected" đọc qua `<link rel=stylesheet>`
  onload/onerror (fetch sẽ bị reject vì CORS); một probe hiệu chuẩn làm cổng
  cho ma trận — nếu bị chặn, các ô hiển thị "untestable" trung thực thay vì
  kết quả bịa.
- Các pill trạng thái mới phỏng theo thanh status bar của bản gốc: **RTT**
  (15 probe, ngưỡng xanh ≤150ms / vàng ≤500ms / đỏ như bản gốc), **IPv6**,
  **ADoX**, **EDNS** (kích thước UDP advertise, vàng nếu <1200), **DNSSEC**.
  Bỏ ECH — `X-ECH-Status` không đọc được cross-origin.
- Các subnet ECS giờ cũng có dòng riêng ("Your DNS resolvers advertise
  your IP subnet (ECS)"); bảng resolvers giữ nguyên với enrichment PTR.

## 2026-10-14 18:09 — Phase 8c: detailed test uses vietcdn's real servers (`64bbe41` pt.1)

- "Detailed test" làm lại theo quyết định của Jeremie (ưu tiên dùng hạ tầng của
  họ): giờ đo với **8 server thật của vietcdn.net** (Netherlands, RBX, HKG1,
  SGP1, TYO1, LAX1, TLV1, Cloudflare qua Real-Debrid, file test 10&nbsp;GiB —
  URL lấy từ page source của vietcdn.net, đã verify tất cả reachable với
  `Access-Control-Allow-Origin: *`), cộng thêm hàng **Cloudflare edge (site
  này)** dùng file 20&nbsp;MB tự host làm dự phòng.
- Mỗi server: lượt single-connection rồi tới lượt 6-connection chạy tuần tự
  (cửa sổ 10s, **1.5s warmup grace như bản gốc**, cùng công thức Mbps); các
  hàng hiện dần với Mbps trực tiếp; lượt nào lỗi đánh dấu "failed" mà không
  dừng cả bài đo.
- Trình bày hàng phỏng theo vietcdn.net: cờ mỗi server (flagcdn.com, huy hiệu
  ☁ cam cho hàng Cloudflare), ghim 📍 ở HKG1 (lựa chọn "closest server" của
  họ cho khách từ VN), huy hiệu **Multi** ở hàng 6-connection, Mbps trực tiếp
  in đậm + MB/s 1 số thập phân, thanh tiến trình tổng, dòng tóm tắt
  single-connection nhanh nhất. Cố tình KHÔNG copy: danh sách IP server
  hardcode của họ, ghi chú ISP-report, ô visitor-IP, và telemetry kết quả
  (API của họ).
- Nút **Stop** mới (dừng ngay, giữ các hàng đã xong) và dòng tiến trình
  ("Server 3/9 …"); chạy full khoảng 3 phút; vẫn loại trừ lẫn nhau với bài
  test đơn giản. Ghi chú dưới mục này credit hạ tầng Real-Debrid/vietcdn.net.
- Follow-up sau QA: các hàng đã xong không bao giờ bị xóa khi hoàn tất/dừng
  ("Run again" mới xóa và chạy lại); `renderSpeedtest()` không re-render khi
  đang có bài test chạy (re-render do hashchange không thể xóa hàng giữa
  chừng); `refreshState()` kiểm tra shape của payload `/api/state` và bọc mỗi
  lần render bằng try/catch + console logging — payload xấu hay exception lúc
  render thì giữ DOM tốt cuối cùng và thử lại ở chu kỳ sau thay vì trắng trang.

## 2026-10-14 17:58 — Phase 9: DNS Tools tab (`923b59a`)

- Tab **DNS Tools** mới (`#dns`, cạnh Speedtest), chỉ frontend.
- **DNS Lookup**: ô nhập domain + chọn loại record (A/AAAA/CNAME/MX/TXT/NS/
  SOA/SRV/PTR/CAA), validate phía client, IP→reverse-DNS tự động cho PTR.
  Trừu tượng hóa provider: chính là dnscheck.tools (addr.tools), tự động
  fallback sang Cloudflare DNS-over-HTTPS khi lỗi (`DNS_PROVIDER_ORDER` =
  đổi một dòng); NXDOMAIN/SERVFAIL xử lý như trạng thái có thông tin; hiển thị
  thời gian query; bảng kết quả có tên type, TTL, data; spinner loading;
  Enter để submit.
- **DNS Leak Test**: tái hiện luồng chính của dnscheck.tools — client ID ngẫu
  nhiên, WebSocket tới hạ tầng của họ, query kích hoạt `no-cors`, gom nhóm
  resolver (IP/protocol/ECS/số query) với reverse DNS kiểu best-effort; thông
  báo "unreachable" nhã nhặn nếu WebSocket của họ bị chặn. Chỉ hiển thị; không
  bao giờ làm crash trang.

## 2026-10-14 17:53 — Phase 8b: vietcdn-style detailed speedtest (`fce7a4a`)

- Mục "Detailed test" mới trong tab Speedtest (dưới các thẻ tóm tắt): các lượt
  download single-connection rồi 6-connection chạy tuần tự vào Cloudflare
  edge, các hàng hiện dần với Mbps trực tiếp như vietcdn.net. Cùng file test
  20&nbsp;MB và công thức Mbps; nút start riêng, không tự chạy; hai chế độ
  test loại trừ lẫn nhau để không làm lệch số liệu của nhau.

## 2026-10-14 17:39 — Phase 8: self-hosted speedtest tab (`bc88561`)

- Tab **Speedtest** mới cạnh Incidents (deep-link `#speedtest`): đo **ping**
  (trung vị của 3 lần fetch `/api/state` bấm giờ), **download** và **upload**
  từ trình duyệt của khách tới Cloudflare edge, kiểu vietcdn.net (cửa sổ 10s
  cố định, 1s warmup grace, Mbps = 8·bytes/s·1.1/1048576).
- Hoàn toàn tự host: download kéo asset tĩnh 20&nbsp;MB bytes ngẫu nhiên
  (`public/speedtest-20m.bin`, 4 luồng song song request lại khi cần); upload
  POST các blob 2&nbsp;MB ngẫu nhiên được sinh ra tới endpoint mới
  `POST /speedtest/upload` của Worker (đọc rồi bỏ body, không ghi KV). Không
  dùng băng thông bên thứ ba.
- Chỉ chạy khi bấm nút, số liệu cập nhật trực tiếp, lỗi cô lập theo từng
  metric.
## 2026-10-14 16:32 — Phase 7: measure latency from your browser (`345e7d7`)

- Thẻ "Latency from your browser" mới: đo RTT trực tiếp từ trình duyệt của
  khách tới cả 13 POP qua `GET https://<host>/info` bấm giờ bằng
  `performance.now()` (kiểu ping.nextdns.io). Kết quả xếp từ nhanh đến chậm,
  POP nhanh nhất được highlight, hiển thị kèm rtt do server báo.
- Bổ sung (không thay thế) các phép đo cron phía server vốn nuôi history,
  uptime % và incidents. Không tự chạy; chỉ chạy khi bấm nút.
- Chỉ frontend: không đụng Worker, KV hay config.

## 2026-10-14 16:22 — Phase 6: latency threshold alerts (`a065509`)

- `latencyThresholdMs` cho từng monitor trong `config.yaml` (ngưỡng suy ra từ
  baseline p50/p95 thực tế).
- Frontend tính trung vị của 12 điểm latency gần nhất (cần ≥3 điểm); vượt
  ngưỡng thì hiện pill cam "High latency" kèm tooltip native, cộng thêm đường
  ngưỡng cam đứt nét trên chart 12h.
- Chỉ visual: không ảnh hưởng cách tính uptime %, trạng thái operational, giá
  trị Overall, số lượng group hay incidents. Không đụng Worker/KV.

## 2026-10-14 15:00–15:16 — Sửa lỗi

- **15:16** — Sửa QA Phase 5 (`0c33ba0`): sửa crash `renderIncidents` (sai tên biến) làm trắng view Incidents; tên monitor lại là link (gạch chân, tooltip native, tab mới).
- **15:00** — Pager Incidents giới hạn trong cửa sổ dữ liệu KV (`de3cdec`): pager tháng không thể vượt quá tháng sớm nhất còn dữ liệu KV cũng không đi vào các tháng tương lai.

## 2026-10-14 15:08 — Phase 5: UptimeFlare parity refinements (`a61b55f`)

- Tiêu đề modal incident giờ là `🚨 {Monitor} incidents at {D/M/YYYY}`.
- Không tooltip trên các bar xám no-data; bar được hover sáng lên thành
  `#9DEAB8`; con trỏ mặc định trên các bar.
- Bỏ icon ⓘ info; link tên monitor mang tooltip `title` native.
- Footer: `Powered by Cloudflare Workers, made with ❤ by nguyenvanquoctrung
  · Get Your Status Page`.
- Cửa sổ bảo trì định kỳ: `maintenances:` trong `config.yaml`
  (title/body/monitors/start/end/color), render thành thẻ trên view Incidents
  và thành tam giác vàng trên hàng monitor trong thời gian bảo trì. Chỉ hiển
  thị; logic notification của Worker giữ nguyên.
- Dark mode: mặc định theo OS, nút chuyển 3 trạng thái thủ công
  (auto → light → dark) lưu trong localStorage.
- Mọi giờ hiển thị theo Asia/Saigon kèm nhãn `GMT+7`.

## 2026-10-14 14:56 — Phase 4: 12h intraday latency chart (`cd7e990`)

- Thay chart latency ngày 90-day bằng chart intraday 12h như UptimeFlare: ring
  buffer theo từng lần check trong KV (tỉa còn 12h, đi ké lần ghi duy nhất
  mỗi chu kỳ — không thêm lần ghi KV nào), đường slate 2px mượt, trục giờ,
  tooltip hover đen có timestamp + latency/location, khoảng trống ở các lần
  check lỗi, placeholder "No data yet" trong lúc đang đầy dần.

## 2026-10-14 13:34–14:44 — Tinh chỉnh & tài liệu

- **14:44** — Rộng thẻ 897px (`140972e`): về lại chiều rộng UptimeFlare-with-groups để 90 bar vừa khít không bị giãn.
- **14:41** — Dải 90-bar gọn (`fd61f27`): bar 7px, bước ~9px, ôm sát nội dung thay vì giãn full chiều rộng.
- **14:38 / 14:31** — Tài liệu dự án độc lập (`511d1d0`, `b7d8236`): chủ sở hữu LICENSE, contact của Code of Conduct và README được viết lại; credit upstream chỉ giữ trong mục Credits của README.
- **14:30** — Cách tính uptime kiểu UptimeFlare (`ff676b9`): Overall % tính theo trọng số thời gian (như UptimeFlare) thay vì đếm số lần check.
- **13:34** — Cron mỗi 10 phút (`6a35550`): ~144 lần ghi KV/ngày, an toàn dưới quota 1.000/ngày của free tier (trước đây chạm ngưỡng cảnh báo 50%).

## 2026-10-14 14:27 — Phase 3: groups, incidents, ticker (`bec3b29`)

- Lưu trữ 90 ngày; monitor gom nhóm (🇻🇳 Vietnam 4 / 🌏 International 9); nhớ
  trạng thái accordion; view Incidents có pager tháng, bộ lọc monitor và
  deep-link `#incidents`; ticker hero trực tiếp mỗi giây.

## 2026-10-14 14:15–14:20 — Phase 2: UptimeFlare UI spec (`88bae91`, `5eb6e55`)

- Dải bar uptime 90 ngày, 4 mức màu theo ngày, tooltip/modal ngày, ngày tháng
  theo locale.

## 2026-10-14 14:01 — Phase 1: UptimeFlare restyle (`a97c583`)

- Frontend restyle theo ngôn ngữ thiết kế UptimeFlare.

## 2026-10-13 — Viết lại & chuẩn bị deploy

- Hiện đại hóa lên wrangler v4 / modules Worker (`d67af39`); sửa deploy cho
  Node 22 và tạo KV namespace (`312ee2c`, `adc021e`); cấu hình 13 NextDNS
  edge monitor (`9a7d020`).
