# AGENTS.md - AULAC OCEANUS 3D DASHBOARD
**Công ty Cổ phần Tư vấn Xây dựng Âu Lạc**

## Overview
Hệ thống trực quan hóa 3D dữ liệu đo độ sâu lòng sông và phân tích mặt cắt địa hình đáy sông (**AULAC OCEANUS 3D DASHBOARD**).
Sản phẩm phần mềm web GIS 3D chuyên dụng thuộc **Công ty Cổ phần Tư vấn Xây dựng Âu Lạc**, thiết kế dưới dạng Single-Page Web Dashboard hiện đại, chạy mượt mà trực tiếp trên trình duyệt web không cần các bước build rườm rà.

## Project Structure & Architecture
```
d:\4. code\3d_visualization\
├── AGENTS.md                                   # Quy chuẩn & Hướng dẫn dự án Âu Lạc
├── index.html                                  # Khung giao diện Web Dashboard AULAC OCEANUS 3D
├── AULAC.png                                   # Logo Công ty CP Tư vấn Xây dựng Âu Lạc
├── Travinh - HS_L0002_2026-03-06-sang.txt      # File dữ liệu đo độ sâu mặc định (VN-2000)
├── css/
│   └── styles.css                              # Design System Liquid Glass (Apple-inspired)
└── js/
    ├── app.js                                  # Main Application Controller
    ├── colorRamps.js                           # Bảng màu độ sâu (Heatmaps/Palettes)
    ├── dataLoader.js                           # Parse dữ liệu TXT/CSV & Chuẩn hóa tọa độ
    ├── scene3D.js                              # Quản lý WebGL Canvas 3D (Three.js)
    ├── crossSection.js                         # Thuật toán trích xuất, GIS basemap & mặt cắt Leaflet
    ├── chartManager.js                         # Vẽ biểu đồ mặt cắt 2D (Chart.js)
    └── sampleData.js                           # Dữ liệu mẫu nén tích hợp sẵn (fallback)
```

## Data Specifications & Coordinate Transformations
1. **Định dạng file dữ liệu đầu vào**: File văn bản định dạng CSV hoặc TXT phân tách bằng dấu cách/Tab (`ID  X  Y  Z`).
   - `ID`: Mã định danh điểm đo (VD: `gj000001`).
   - `X`: Tọa độ X trong hệ VN-2000 / UTM (VD: `1109271.482` mét - Northing).
   - `Y`: Tọa độ Y trong hệ VN-2000 / UTM (VD: `580000.000` mét - Easting).
   - `Z`: Độ cao / Độ sâu địa hình đáy sông (VD: `-5.285` mét, âm là dưới mực nước biển/mực chuẩn).

2. **Chuyển đổi Tọa độ GIS (VN-2000 Trà Vinh & Proj4js)**:
   - **Tọa độ 3D Three.js**: Chuẩn hóa về tâm `(0,0,0)`:
     - `x3D = x - meanX`
     - `y3D = z` (trục Y hướng lên trong Three.js)
     - `z3D = -(y - meanY)` (trục Z hướng ra trong Three.js)
   - **Tọa độ Địa lý WGS84 (Google Satellite Basemap)**: Sử dụng phép chiếu VN-2000 Nội tỉnh Trà Vinh (`Kinh tuyến trục 105.5°`, `Múi chiếu 3°`, `k=0.9999`) bằng thư viện `proj4.js`:
     - `proj4("VN2000_TRAVINH", "EPSG:4326", [y, x])` -> `[Lng, Lat]`

## 3D Rendering Rules (Three.js)
- **Geometry**: Tạo Lưới bề mặt (Surface Mesh) dựa trên lưới ô vuông / Delaunay triangulation hoặc Point Cloud (THREE.Points).
- **Vertex Color**: Màu sắc của từng đỉnh lưới phụ thuộc vào giá trị Z (độ sâu) tương ứng với Color Ramp đang chọn.
- **Z-Exaggeration**: Nhân giá trị Z với hệ số phóng đại (Exaggeration factor: 1x - 10x) để nổi bật địa hình lòng sông.
- **Buffer Updates**: Cập nhật màu sắc (`color.needsUpdate = true`) và tọa độ đỉnh (`position.needsUpdate = true`) trực tiếp trên GPU không reset camera.
- **Mặt nước (Water Surface)**: Mặt phẳng trong suốt Z=0 có chuyển động sóng nhẹ để mô phỏng mực nước thực tế.

## 2D GIS Map & Google Satellite Layer
- **Nền bản đồ Google Vệ tinh Cố định (Fixed Google Satellite Basemap)**:
  - Bản đồ 2D mặc định và cố định sử dụng ảnh vệ tinh **Google Satellite Hybrid** (`https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}`), tích hợp sẵn nhãn tên sông, địa danh và công trình Trà Vinh.
  - Người dùng không cần thao tác chọn nền bản đồ; giao diện Sidebar được tối ưu gọn gàng.
- **Vẽ tuyến cắt A-B**: Điểm đánh dấu (Marker) A và B có thể kéo thả trực tiếp trên bản đồ Google Vệ tinh hoặc click chọn vị trí mới.
- **Cập nhật thời gian thực**: Khi kéo Marker A/B, đường cắt 3D và đồ thị 2D cập nhật liên tục.

## Coding Standards & UI Aesthetics
- Sử dụng Vanilla JavaScript ES6+, HTML5 semantic, và Vanilla CSS3.
- Hệ thiết kế **Liquid Glass (Apple-inspired)**: panel kính lỏng trong suốt (`backdrop-filter` + sheen/rim động), ambient blob phía sau, typography system SF Pro stack, text `#1d1d1f` / muted `#6e6e73`, accent cam thương hiệu **#ea580c** dùng sparingly cho CTA và highlight độ sâu.
- Đảm bảo hiệu năng mượt mà 60fps.
