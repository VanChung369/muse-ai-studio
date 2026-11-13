# Muse AI Studio — Brief thiết kế UX/UI

Bạn là Senior Product Designer kiêm UX Architect. Hãy thiết kế lại ứng dụng dưới đây thành một studio AI hoàn chỉnh, dễ sử dụng và có thể bàn giao cho frontend triển khai.

## 1. Mục tiêu và phạm vi

- Tên sản phẩm: **Muse AI Studio**.
- Tagline: **Từ ý tưởng đến từng thước phim.**
- Đây là ứng dụng self-hosted kết nối với Muse để tạo ảnh, video và vận hành các tài khoản phục vụ tác vụ.
- Người dùng chính là người sáng tạo nội dung; người quản trị cần quản lý tài khoản, tác vụ và kết nối API.
- Giai đoạn này làm UX/UI và prototype bằng dữ liệu mẫu. Chưa triển khai backend, chưa gọi dịch vụ Muse thật, chưa tiêu thụ quota.
- Mục tiêu là tổ chức lại trải nghiệm và luồng công việc, không chỉ thay màu hoặc trang trí giao diện cũ.

Nguồn tham khảo của project cũ: `admin.html`, `README.md` và `docs/video-projects.md`. Source thực tế được ưu tiên khi mô tả trong tài liệu cũ có mâu thuẫn. Không suy luận sản phẩm từ tên thư mục `ai-meeting`.

## Ràng buộc kỹ thuật đã chốt

- Frontend: React + TypeScript + Vite; điều hướng React Router.
- UI: Tailwind CSS, shadcn/ui và Lucide React; form dùng React Hook Form + Zod.
- Dữ liệu demo tách riêng để sau này kết nối FastAPI qua TanStack Query.
- Khi triển khai, frontend được build thành file tĩnh và FastAPI phục vụ cùng API trên một cổng.
- Toàn bộ sản phẩm chạy trong một container với SQLite, Chromium và FFmpeg; dữ liệu lưu trong `data/`. Xem `architecture.md`.
- Không tạo luồng yêu cầu người dùng cài hoặc cấu hình Redis, Celery hay PostgreSQL.
- Giai đoạn prototype chỉ mô phỏng thao tác bằng dữ liệu demo, chưa gọi Muse hoặc backend thật.

## 2. Vấn đề cần giải quyết

Giao diện cũ gom quản lý tài khoản, nhập cookie, tác vụ, media, playground, studio và tài liệu vào một trang nhiều tab. Form tạo video dài, nhiều thông số hiện cùng lúc. Thông tin kỹ thuật và hướng dẫn chiếm nhiều diện tích. Danh sách cảnh, thao tác render và kết quả chưa tạo thành một không gian làm việc sáng tạo thống nhất.

Thiết kế mới phải giúp người mới biết bắt đầu từ đâu, người đang tạo video biết bước tiếp theo và người quản trị nhanh chóng xử lý vấn đề.

## 3. Kiến trúc thông tin đề xuất

Dùng sidebar ổn định, chia nhóm rõ ràng:

**Sáng tạo**
- Tổng quan.
- Dự án video.
- Tạo ảnh / video ngắn.
- Thư viện media.
- Tác vụ.

**Quản trị và tích hợp**
- Tài khoản Muse.
- Kết nối API: địa chỉ dịch vụ và API key.
- API Playground.
- Tài liệu và cài đặt liên quan đến chức năng đã có.

Có thể điều chỉnh sitemap nếu hợp lý hơn; giải thích ngắn gọn quyết định. Mỗi màn hình có tiêu đề và hành động chính rõ ràng. Các thông số kỹ thuật đặt tại nơi người dùng cần chúng.

## 4. Luồng ưu tiên: tạo video dài

**Ý tưởng → Kịch bản → Duyệt cảnh → Render → Thành phẩm.**

### Danh sách dự án

Hiển thị thumbnail khi có, tên, ngày cập nhật, thời lượng, tỉ lệ khung hình và trạng thái. Có tạo mới, tìm kiếm, lọc và tiếp tục dự án. Empty state đưa người dùng tới hành động tạo dự án đầu tiên.

### Tạo dự án

- Ô nhập ý tưởng là trọng tâm.
- Thời lượng 10–300 giây, theo bước 5 giây; tỉ lệ `16:9`, `9:16`, `1:1`.
- Mỗi cảnh tối đa 10 giây; ví dụ 60 giây tương ứng 6 cảnh.
- Tối đa 3 ảnh tham chiếu nhân vật hoặc sản phẩm; có preview và xóa từng ảnh.
- Phong cách, thể loại/cảm xúc, mô tả nhân vật cần giữ nhất quán.
- Giữ hoặc tắt âm thanh cảnh; nhạc nền tùy chọn và mức nhạc.
- Lời dẫn: giọng đọc chung hoặc lời nói bên trong từng clip; nêu trạng thái không khả dụng khi dịch vụ không hỗ trợ.
- Tùy chọn planner tự cải thiện kịch bản, số lần thử tự động 1–3 mỗi cảnh và tự render sau khi lập kế hoạch.
- Nhóm các tùy chọn nâng cao; mặc định cho người dùng duyệt kịch bản trước khi render.
- Hiển thị số cảnh dự kiến. Không bịa giá, quota còn lại hoặc thời gian hoàn thành.

### Workspace duyệt và chỉnh sửa

Thiết kế khu vực danh sách cảnh, preview trung tâm và bảng thuộc tính. Người dùng có thể xem/chỉnh tên phim, tóm tắt, nhân vật dùng chung, phong cách và nội dung từng cảnh.

Mỗi cảnh có số thứ tự, tên, thời lượng, prompt, âm thanh, lời dẫn khi có, trạng thái và kết quả. Chi tiết nâng cao như trạng thái bắt đầu/kết thúc, nhân vật xuất hiện và chuyển cảnh có thể nằm trong bảng thuộc tính.

Dùng storyboard hoặc scene strip để chuyển cảnh và xem tiến độ. Chưa giả định có trim clip, kéo thả thay đổi thứ tự, chỉnh keyframe, timeline nhiều track hoặc trình dựng video chuyên nghiệp.

### Render và phục hồi

- Trạng thái dự án thực tế: `planning`, `ready`, `rendering`, `cancelling`, `cancelled`, `failed`, `completed`.
- Hiển thị giai đoạn hiện tại, số cảnh đã xong và lỗi có thể xử lý. Không giả lập phần trăm tiến độ khi backend chưa cung cấp.
- Tạm khóa chỉnh sửa kịch bản trong lúc xử lý.
- Hủy có hiệu lực sau bước hiện tại; giao diện phải giải thích rõ và giữ các cảnh đã hoàn thành.
- Cho phép tiếp tục render dự án lỗi hoặc đã hủy, tái sử dụng các cảnh hợp lệ.
- Tạo lại từ một cảnh sẽ tạo lại cảnh đó và mọi cảnh sau.
- Sửa prompt cảnh ảnh hưởng cảnh đó và các cảnh sau; sửa thông tin nhận diện/phong cách chung có thể ảnh hưởng toàn bộ cảnh.
- Chỉnh riêng lời dẫn ở chế độ giọng đọc chung có thể chỉ dựng lại âm thanh; không mặc định báo phải tạo lại mọi clip.
- Xác nhận trước thao tác làm mất hiệu lực kết quả đã có và nêu rõ phạm vi ảnh hưởng.
- Giữ được kịch bản và các cảnh đã tạo khi cần bắt đầu cuộc hội thoại Muse riêng; đặt thao tác này trong phần nâng cao.

### Thành phẩm

Preview video hoàn chỉnh, tải video, tải từng cảnh và xuất kịch bản/prompt. Lối quay lại dự án và xử lý cảnh lỗi phải dễ thấy. Ảnh tham chiếu giúp giữ nhất quán, nhưng không cam kết nhân vật giống tuyệt đối giữa mọi cảnh.

## 5. Các màn hình hỗ trợ

- **Tổng quan:** dự án gần đây, tác vụ đang chạy, tình trạng tài khoản và lối tắt tạo nội dung. Không thêm biểu đồ hoặc KPI thiếu dữ liệu thực.
- **Tạo ảnh/video ngắn:** prompt, cấu hình phù hợp từng loại, tham chiếu khi API hỗ trợ, preview và kết quả; phân biệt đang chờ với đang xử lý.
- **Media Library:** thumbnail, lọc ảnh/video, preview, tải xuống, chọn nhiều và xóa có xác nhận. Không mặc định có gắn tag hoặc tìm kiếm ngữ nghĩa.
- **Tasks:** dễ xem trạng thái, lỗi, kết quả; chỉ hiển thị thao tác thử lại nếu có API thực tế hỗ trợ.
- **Accounts:** trạng thái, quota khi có, hạn phiên và hành động thường dùng. Chi tiết ID, proxy và chẩn đoán nằm trong drawer hoặc trang chi tiết. Phân biệt không có dữ liệu quota với quota bằng 0.
- **Import tài khoản:** hỗ trợ nhập hàng loạt và hướng dẫn extension theo bước; có phản hồi thành công/thất bại dễ hiểu.
- **Kết nối API:** sao chép base URL, API key che mặc định, hành động xem/sao chép/đổi key rõ ràng.
- **API Playground và tài liệu:** tách khỏi luồng sáng tạo, có ví dụ dễ sao chép và phản hồi request rõ ràng.

Không trình bày billing, cộng tác nhóm, đăng nhập nhiều người, model marketplace hoặc các tính năng chưa có như chức năng đã triển khai. Nếu đề xuất, ghi riêng là hướng phát triển tương lai.

## 6. Ngôn ngữ thị giác

- Studio sáng tạo chuyên nghiệp với dark theme charcoal, bề mặt phân lớp vừa đủ và một màu nhấn nhất quán.
- Ưu tiên video preview, thumbnail và storyboard; tránh gradient tím xanh, glow và card trang trí tràn lan.
- Typography hỗ trợ tiếng Việt tốt, hệ khoảng cách rõ, icon nhất quán; không dùng emoji thay icon giao diện.
- Mật độ phù hợp làm việc lâu, hành động chính/phụ phân cấp rõ.
- Nhãn và nội dung bằng tiếng Việt tự nhiên; thuật ngữ kỹ thuật chỉ xuất hiện khi giúp người dùng quyết định.
- Đảm bảo tương phản, focus bàn phím, label cho input và thông báo trạng thái dễ tiếp cận.
- Desktop là ưu tiên. Ở tablet/mobile, chuyển các panel thành tab hoặc drawer và giữ luồng thao tác chính sử dụng được.

## 7. Kết quả cần bàn giao

1. Nhận xét UX ngắn dựa trên source, sitemap và luồng chính.
2. Design system: màu, typography, spacing, layout, button, input, badge, table, drawer, modal và thông báo.
3. Thiết kế high-fidelity các màn hình quan trọng; ưu tiên danh sách dự án, tạo dự án, workspace duyệt cảnh, render và thành phẩm.
4. Prototype có tương tác: tạo dự án → duyệt kịch bản → chỉnh cảnh → render → xem/tải thành phẩm. Có thêm tình huống lỗi và tiếp tục render.
5. Trạng thái loading, empty, error, success, disabled và xác nhận thao tác có hậu quả.
6. Ghi chú bàn giao frontend: hành vi component, responsive, dữ liệu cần và chỗ thiếu API. Tách rõ dữ liệu backend hiện có với tương tác prototype mô phỏng.

Dùng dữ liệu demo thực tế và nhất quán giữa màn hình: ví dụ một dự án 60 giây gồm 6 cảnh, tỉ lệ 16:9, kể chuyện một chú mèo cam khám phá khu vườn bí mật. Ghi rõ dữ liệu demo; không đặt cookie, API key hoặc tài khoản thật vào thiết kế.

Tự quyết định chi tiết thiết kế thông thường. Chỉ hỏi khi thông tin thiếu ảnh hưởng trực tiếp đến bản chất sản phẩm. Hãy tạo kết quả thiết kế/prototype cụ thể theo khả năng công cụ, không dừng ở một bản mô tả ý tưởng chung chung.
