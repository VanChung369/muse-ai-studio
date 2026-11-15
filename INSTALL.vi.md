# Cài đặt Muse AI Studio bằng một lệnh

Trình cài đặt tự cài những gì máy còn thiếu, dựng môi trường cho backend, build giao diện bản production rồi chạy app. Backend phục vụ luôn giao diện đã build, nên chỉ có **một** server, **một** địa chỉ.

Chạy được trên:

- Windows 10/11 (x64 hoặc ARM64)
- macOS 13.5 trở lên (Intel hoặc Apple Silicon)
- Linux 64-bit có glibc 2.28 trở lên: Ubuntu 20.04+, Debian 10+, Fedora, RHEL/Rocky 8+, Arch… (x64 hoặc ARM64)

Không cần quyền admin, không cần winget hay Homebrew. Máy chỉ cần có mạng, và bạn cần một tài khoản Muse. Những gì còn thiếu, script tự lo:

| Thiếu | Script làm gì |
| --- | --- |
| uv, Python | Cài uv (trong thư mục người dùng); uv tự tải Python 3.12+ |
| Node.js 22.12+ | Tải Node.js 24 bản portable vào `.tools/node` của dự án (có kiểm tra SHA-256) |
| FFmpeg | Tải FFmpeg dựng sẵn (gói `imageio-ffmpeg` trên PyPI) vào `.tools/ffmpeg` |
| Chrome / Edge / Brave / Chromium | Tải Chromium của Playwright. Trên Ubuntu/Debian còn cài thư viện hệ thống mà Chromium cần (lúc này mới hỏi mật khẩu `sudo`) |

Máy nào đã có sẵn Node.js 22.12+, FFmpeg hay trình duyệt thì script dùng luôn cái có sẵn. Cuối cùng script khởi động thử trình duyệt một lần và báo nếu không chạy được.

## Windows

Bấm đúp **`install.cmd`** trong thư mục dự án. Hoặc mở PowerShell trong thư mục đó rồi chạy:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

Script sẽ:

1. Cài những công cụ còn thiếu (bảng ở trên).
2. Cài thư viện backend (`uv sync --locked`) và tạo `backend\.env` từ `.env.example`.
3. Cài thư viện frontend (`npm ci`) và build giao diện (`npm run build` → `frontend\dist`).
4. Chạy app và mở trình duyệt tại `http://127.0.0.1:18610`.

Chỉ cài, không chạy: thêm `-NoStart`.

## macOS / Linux

```bash
bash install.sh
```

Script làm các bước như trên. Trên Linux, script chỉ hỏi mật khẩu `sudo` trong hai trường hợp: máy không có cả `curl` lẫn `wget`, hoặc phải cài thư viện cho Chromium. Chỉ cài, không chạy: `bash install.sh --no-start`.

Linux dùng musl như Alpine không được hỗ trợ, vì Chromium và Node.js cần glibc.

## Những lần sau

| Việc | Windows | macOS / Linux |
| --- | --- | --- |
| Chạy app | bấm đúp `start.cmd` | `bash start.sh` |
| Đổi cổng | `... start.ps1 -Port 8080` | `bash start.sh --port 8080` |
| Cho máy khác trong mạng LAN truy cập | `... start.ps1 -Lan` | `bash start.sh --lan` |
| Cập nhật sau khi `git pull` | bấm đúp lại `install.cmd` | chạy lại `bash install.sh` |

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
- Node.js và FFmpeg mà script tự tải nằm trong `.tools/`. Xoá thư mục này thì lần cài sau script tải lại.
- Các yêu cầu có nội dung cờ bạc, ma túy, vũ khí, khiêu dâm, lừa đảo, hack, buôn người, khủng bố… bị chặn trước khi gửi sang Muse (không tốn quota) và app hiện thông báo lý do. Thêm từ cần chặn: `MUSE_BLOCKED_TERMS=từ một, từ hai` trong `backend\.env`.
- Khi phát triển giao diện (hot reload), dùng cách chạy hai terminal trong [README.md](README.md#run-for-development).
