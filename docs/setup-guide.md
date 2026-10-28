# Hướng dẫn cài đặt JOY Dev Board (chạy trên máy cá nhân)

Hướng dẫn này để chạy board trên máy của bạn. Không cần biết code, chỉ cần copy từng lệnh vào Terminal.
Toàn bộ khoảng 10 phút.

Board chỉ **đọc** ticket từ HelpDesk, không bao giờ sửa hay ghi gì ngược lại HelpDesk.

## 1. Chuẩn bị

Cần có:

- **macOS** hoặc **Linux** (Windows thì dùng WSL).
- **Git**. Kiểm tra bằng `git --version`. Trên macOS nếu chưa có thì máy sẽ tự hỏi cài.
- **Bun**, công cụ chạy app. Cài bằng lệnh:

  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```

  Sau đó đóng Terminal, mở lại rồi kiểm tra bằng `bun --version` (cần từ 1.3 trở lên).

- **Ba giá trị bí mật**, lấy từ người quản lý repo qua kênh riêng tư (không dán vào Slack public hoặc email):
  - `API_KEY_HELPDESK`: key đọc ticket từ HelpDesk
  - `WEBHOOK_SECRET`: secret của webhook Avada
  - (tuỳ chọn) bạn tự đặt username và mật khẩu đăng nhập ở bước 3

## 2. Tải code về

```bash
git clone https://github.com/honganhdev/issue-board.git
cd issue-board
bun install
```

## 3. Tạo file cấu hình `.env`

```bash
cp .env.example .env
```

Mở file `.env` bằng editor bất kỳ (ví dụ `open -e .env` trên macOS) và điền:

```dotenv
API_KEY_HELPDESK=<key nhận được>
WEBHOOK_SECRET=<secret nhận được>
AUTH_USERNAME=<username bạn muốn dùng để đăng nhập, ví dụ pm>
```

Tạo mật khẩu đăng nhập:

```bash
bun run auth:hash
```

Lệnh sẽ hỏi mật khẩu (gõ không hiện chữ là bình thường), rồi in ra **một dòng** dạng
`AUTH_PASSWORD_HASH=...`. Copy **nguyên dòng đó**, dán vào `.env` (không thêm dấu nháy).

Cuối cùng, vì chạy trên máy (http, không phải https), thêm dòng sau:

```bash
echo 'COOKIE_SECURE=false' >> .env
```

> File `.env` chứa bí mật. Đừng gửi nó cho ai và đừng commit nó (git đã được cấu hình để bỏ qua file này).

## 4. Chạy board

```bash
bun run dev
```

Mở trình duyệt vào **http://localhost:5173** và đăng nhập bằng username và mật khẩu ở bước 3.

Lần chạy đầu tiên app sẽ tạo database `data/board.db` và kéo ticket từ HelpDesk, nên có thể mất vài giây.
Những lần sau board hiện ngay.

Muốn tắt: bấm `Ctrl + C` trong Terminal. Muốn chạy lại: `cd issue-board` rồi `bun run dev`.

## 5. Cập nhật bản mới

```bash
cd issue-board
git pull
bun install
bun run dev
```

## Lưu ý

- **Lịch sử trạng thái chỉ tính từ lúc bạn cài.** HelpDesk chỉ trả về trạng thái hiện tại của ticket, nên các
  số liệu như "đã nằm ở cột này bao lâu" bắt đầu được ghi từ lần chạy đầu tiên trên máy bạn.
- **Webhook realtime không hoạt động trên máy cá nhân**, vì Avada không gọi được vào localhost. Bấm nút **Pull HelpDesk**
  trên board để lấy ticket mới nhất.
- Board hiển thị email merchant, domain shop và link Crisp. Đừng chụp màn hình gửi ra ngoài công ty.

## Gặp lỗi

| Lỗi | Cách xử lý |
|-----|------------|
| `command not found: bun` | Đóng Terminal, mở lại. Vẫn lỗi thì chạy lại lệnh cài Bun ở bước 1. |
| `API_KEY_HELPDESK is not set` / `WEBHOOK_SECRET is not set` / `AUTH_USERNAME is not set` | Kiểm tra lại `.env` ở bước 3: đúng tên biến, không có khoảng trắng quanh dấu `=`. |
| Đăng nhập đúng mật khẩu nhưng vẫn quay lại màn hình login | Thiếu dòng `COOKIE_SECURE=false` trong `.env`. |
| Đăng nhập báo sai mật khẩu | Chạy lại `bun run auth:hash`, dán đè dòng `AUTH_PASSWORD_HASH` mới vào `.env`, rồi khởi động lại. |
| `port 8787` hoặc `5173` đã bị dùng | Có một bản đang chạy ở Terminal khác. Tắt nó đi (`Ctrl + C`) rồi chạy lại. |

Tài liệu kỹ thuật đầy đủ (deploy, MCP, backup) nằm ở [README](../README.md).
