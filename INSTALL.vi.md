# Cài đặt Muse AI Studio bằng một lệnh

Trình cài đặt tự cài những gì máy còn thiếu (uv, Node.js, FFmpeg), dựng môi trường cho backend, build giao diện bản production rồi chạy app. Backend phục vụ luôn giao diện đã build, nên chỉ có **một** server, **một** địa chỉ.

Bạn chỉ cần có sẵn: trình duyệt Chrome, Edge, Brave hoặc Chromium, và một tài khoản Muse.

## Windows

Mở PowerShell trong thư mục dự án rồi chạy:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

Script sẽ:

1. Cài **uv** (quản lý Python) nếu chưa có; uv tự tải đúng Python 3.12+.
2. Cài **Node.js 22.12+** và **FFmpeg** bằng `winget` nếu chưa có.
3. Cài thư viện backend (`uv sync --locked`) và tạo `backend\.env` từ `.env.example`.
4. Cài thư viện frontend (`npm ci`) và build giao diện (`npm run build` → `frontend\dist`).
5. Chạy app và mở trình duyệt tại `http://127.0.0.1:18610`.

Chỉ cài, không chạy: thêm `-NoStart`.

## macOS / Linux

```bash
bash install.sh
```

Script làm các bước như trên; Node.js và FFmpeg được cài qua Homebrew, apt, dnf hoặc pacman (có thể hỏi mật khẩu `sudo`). Chỉ cài, không chạy: `bash install.sh --no-start`.

## Những lần sau

| Việc | Windows | macOS / Linux |
| --- | --- | --- |
| Chạy app | `powershell -ExecutionPolicy Bypass -File start.ps1` | `bash start.sh` |
| Đổi cổng | `... start.ps1 -Port 8080` | `bash start.sh --port 8080` |
| Cho máy khác trong mạng LAN truy cập | `... start.ps1 -Lan` | `bash start.sh --lan` |
| Cập nhật sau khi `git pull` | chạy lại `install.ps1` | chạy lại `bash install.sh` |

Dừng app: bấm `Ctrl+C` trong cửa sổ đang chạy.

Địa chỉ sau khi chạy:

- Giao diện: `http://127.0.0.1:18610`
- API của app: `http://127.0.0.1:18610/api` (tài liệu Swagger: `/api/docs`)
- API tương thích OpenAI: `http://127.0.0.1:18610/v1`

## Sau khi cài

1. Vào **Muse Accounts** → **How to get the token**, làm theo để lấy phiên đăng nhập Muse.
2. Bấm **Import account**, dán vào, rồi bấm **Test**.
3. Tạo dự án đầu tiên trong **Video Studio**, hoặc thử một ảnh trong **Quick Create**.

Trang **Settings** cho biết app đã tìm thấy FFmpeg và trình duyệt hay chưa.

## Lưu ý

- App **không có đăng nhập**: ai mở được địa chỉ của app là dùng được tất cả. Chỉ dùng `-Lan` / `--lan` trong mạng bạn tin cậy.
- Dữ liệu (dự án, video, tài khoản đã mã hoá) nằm trong thư mục `data/`. Sao lưu thư mục này là đủ.
- Các yêu cầu có nội dung cờ bạc, ma túy, vũ khí, khiêu dâm, lừa đảo, hack, buôn người, khủng bố… bị chặn trước khi gửi sang Muse (không tốn quota) và app hiện thông báo lý do. Thêm từ cần chặn: `MUSE_BLOCKED_TERMS=từ một, từ hai` trong `backend\.env`.
- Khi phát triển giao diện (hot reload), dùng cách chạy hai terminal trong [README.md](README.md#run-for-development).
