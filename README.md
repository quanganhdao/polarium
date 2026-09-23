# Polarium JS

Bản làm lại trò giải đố **Polarium Advance** (GBA) bằng JavaScript thuần (Canvas 2D + Web Audio), không cần build.

## Cách chơi

1. Kéo **một nét** qua các ô (ngang/dọc, không tự cắt).
2. Nhấc tay: mọi ô trên nét **lật màu** (đen ⇄ trắng). Khung viền quanh bảng đi được nhưng không lật.
3. Thắng khi **mỗi hàng ngang chỉ còn một màu**.

10 màn: 5 màn khởi động, 5 màn khó dần.

## Chạy

Mở `index.html` bằng trình duyệt. Chơi tốt trên điện thoại (màn dọc) lẫn máy tính.

Bàn phím: mũi tên di chuyển · `Z`/`Enter` bắt đầu & kết thúc nét · `X` hủy · `R` làm lại · `H` bật/tắt gợi ý đường đi · `M` âm thanh.

## Thêm màn

Sửa `js/levels.js`: `'#'` là ô đen, `'.'` là ô trắng, `solution` là đường giải (tọa độ `-1` hoặc `w`/`h` là khung viền).
