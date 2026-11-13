# MUSE2API: thiết kế lại trải nghiệm (bản 1 · 13/11/2026)

Toàn bộ dữ liệu trên màn hình là **dữ liệu demo**. Các chi tiết không có trong brief được gắn nhãn "Giả định" và cần đối chiếu với source code.

## Xem nhanh

Giải nén, mở **`xem-offline/index.html`** bằng trình duyệt (Chrome, Edge, Firefox, Safari).
Prototype bấm được như trên canvas, không cần cài gì.

## Cấu trúc thư mục

```
xem-offline/             Bản xem trực tiếp trên trình duyệt (index.html + support.js offline)
canvas/project/          Các file canvas Design, giống hệt bản đang publish
  canvas.json            Bố cục canvas: vị trí, kích thước, tiêu đề board, ghi chú
  Main.dc.html           00 · Vấn đề UX & định hướng
  Sitemap.dc.html        01 · Sitemap & luồng chính
  DesignSystem.dc.html   02 · Design system
  Projects.dc.html       10 · Video Studio: danh sách dự án
  NewProject.dc.html     11 · Tạo dự án
  Studio.dc.html         12 · Duyệt kịch bản & cảnh
  Render.dc.html         13 · Render & khôi phục lỗi
  Output.dc.html         14 · Thành phẩm
  Dashboard.dc.html      20 · Tổng quan
  QuickCreate.dc.html    21 · Tạo nhanh ảnh / video ngắn
  Library.dc.html        22 · Thư viện media
  Tasks.dc.html          23 · Tác vụ
  Accounts.dc.html       30 · Tài khoản Muse
  ImportAccounts.dc.html 31 · Import tài khoản
  Api.dc.html            32 · Kết nối, khóa API & tài liệu
  Playground.dc.html     33 · API Playground
  Settings.dc.html       34 · Cài đặt
  States.dc.html         40 · Trạng thái
  Responsive.dc.html     41 · Tablet & mobile
  Handoff.dc.html        42 · Ghi chú bàn giao frontend

design-system/muse.css   Token (màu, chữ, bo góc) + toàn bộ class component.
                         Đội frontend có thể dùng trực tiếp hoặc map sang Tailwind theme.

source/                  File gốc dùng để dựng các artboard
  build.py               Bung macro (icon, sidebar, badge) và chèn muse.css
  src/*.dc.html          Bản gốc chứa macro
```

## Mở các file thế nào

- File `.dc.html` là định dạng của canvas Design. Chúng cần file `support.js` nằm cùng thư mục để xử lý `{{...}}`, `<sc-for>`, `<sc-if>`.
  Thư mục `canvas/project/` không có file này (canvas tự cấp), nên mở file ở đó sẽ thấy chữ `{{ ... }}`. Hãy dùng `xem-offline/`.
- `xem-offline/support.js` là runtime rút gọn chỉ để xem offline. Không upload file này lên canvas.
- Cách xem đầy đủ: mở canvas trên claude.ai. Muốn có PNG/PDF thì dùng Share › Export ngay trên canvas.
- Dựng lại từ source: `python3 source/build.py <Tên>.dc.html`.
  Script đọc `source/muse.css` và `source/src/` rồi ghi vào `canvas/project/`. Cần đặt `muse.css` cạnh `build.py`; trong zip đã có sẵn.
