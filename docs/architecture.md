# Muse AI Studio — Kiến trúc đã chốt

Trạng thái: quyết định thiết kế; ứng dụng mới chưa được triển khai.

## Mục tiêu vận hành

Clone repo, chạy một lệnh Docker Compose, mở trình duyệt và cấu hình tài khoản trên giao diện. Người sử dụng chỉ cần Docker có Compose; Python, Node, Chromium và FFmpeg được xử lý trong quá trình build image.

Lệnh mục tiêu sau khi hoàn thiện cấu hình:

```bash
docker compose up -d --build
```

Ứng dụng dùng một cổng, mặc định `18610`, và một thư mục dữ liệu bền vững `data/`. Cấu hình ban đầu có khóa truy cập và import tài khoản Muse trên giao diện.

## Công nghệ

| Thành phần | Lựa chọn |
| --- | --- |
| Frontend | React + TypeScript + Vite |
| Điều hướng | React Router |
| UI | Tailwind CSS + shadcn/ui + Lucide React |
| Dữ liệu server | TanStack Query |
| Form | React Hook Form + Zod |
| Backend | FastAPI + Pydantic |
| Database | SQLite + SQLAlchemy + Alembic |
| Tác vụ | Bộ điều phối tích hợp, trạng thái bền vững trong SQLite |
| Video | FFmpeg + FFprobe |
| Tích hợp Muse | Engine Python và Chromium; tái sử dụng có chọn lọc từ project cũ |
| Đóng gói | Một image, một container ứng dụng, Docker Compose |

Celery, Redis và PostgreSQL không nằm trong yêu cầu vận hành của phiên bản này.

## Đóng gói và luồng chạy

1. Giai đoạn build frontend dùng Node và npm để tạo file tĩnh.
2. Runtime Python chứa backend, frontend đã build, Chromium và FFmpeg/FFprobe.
3. FastAPI phục vụ giao diện và API cùng origin. Route fallback của frontend không được che lỗi API hoặc đường dẫn media không tồn tại.
4. Một process API khởi tạo bộ điều phối tác vụ. Chỉ chạy một instance ứng dụng truy cập thư mục dữ liệu này trong cấu hình mặc định.
5. Điều phối có giới hạn song song và ràng buộc tài khoản; không khởi chạy tác vụ nặng trực tiếp trong request. FFmpeg chạy qua subprocess, công việc đồng bộ không được chặn event loop.

## Lưu trữ

- `data/muse-ai-studio.db`: metadata tài khoản, dự án, cảnh, tác vụ và tiến độ.
- `data/media/`: kết quả ảnh và video.
- `data/projects/`: ảnh tham chiếu riêng tư, file trung gian và tài nguyên dự án.
- `data/browser-profiles/`: trạng thái trình duyệt nếu engine cần lưu.
- SQLite lưu metadata và đường dẫn, file media lưu trên ổ đĩa.
- Mount toàn bộ `data/` vào ổ đĩa local bền vững. Sao lưu database bằng cơ chế nhất quán có xét WAL; đồng bộ cả các file media liên quan.
- Bật WAL, foreign keys và thời gian chờ khóa trên các kết nối phù hợp. Giữ transaction ngắn, không giữ transaction trong lúc gọi Muse hoặc render.
- Chạy migration tự động khi khởi động; lỗi migration phải ngăn ứng dụng nhận tác vụ.

## Tác vụ và khôi phục

- Lưu tác vụ trước khi xử lý; lưu checkpoint sau mỗi bước và mỗi cảnh đã xác minh.
- Phân biệt tiến độ từ dữ liệu thực với trạng thái đang chờ kết quả upstream.
- Tránh chạy trùng cùng tác vụ và tránh dùng đồng thời một tài khoản cho các thao tác xung đột.
- Hủy có hiệu lực sau bước hiện tại; giữ kết quả đã hoàn tất.
- Sau restart, nhận diện tác vụ đang chạy bị gián đoạn và hiển thị hành động tiếp tục. Không tự gửi lại yêu cầu tạo media mà chưa biết yêu cầu trước đã hoàn thành hay chưa.
- Tiếp tục dự án tái sử dụng các cảnh hợp lệ đã hoàn tất. Cảnh đang xử lý cần được đối soát hoặc người dùng cho thử lại.
- Những cơ chế này cần được triển khai và kiểm tra; việc dùng SQLite hoặc chạy nền tự nó không đảm bảo khôi phục đúng.

## Tổ chức mã nguồn dự kiến

```text
frontend/          React app và dữ liệu demo trong giai đoạn thiết kế
backend/           API, cấu hình, database, điều phối và tích hợp Muse
tests/             Kiểm tra luồng quan trọng
docs/              Brief và quyết định kiến trúc
data/              Dữ liệu runtime, không commit
Dockerfile         Build frontend và runtime Python
compose.yaml       Một service ứng dụng với volume dữ liệu
```

Backend chia module theo chức năng. Các quyết định database và xử lý tác vụ không được trộn vào component giao diện.

## Thứ tự thực hiện

1. Prototype Video Studio bằng dữ liệu demo theo `design-brief.md`.
2. Khung frontend và design system sau khi duyệt thiết kế.
3. Backend, database và thiết lập ban đầu.
4. Tích hợp engine Muse, điều phối, hủy và khôi phục.
5. Kiểm tra các luồng quan trọng và đóng gói chạy một lệnh.

Chỉ mở rộng sang database server hoặc hàng đợi bên ngoài khi nhu cầu thực tế vượt kiến trúc một máy này.
