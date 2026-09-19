# AgriTrace — Design System Reference

> This document is the single source of truth for all wireframe screens.
> Every HTML file MUST follow these patterns exactly.

## 1. HTML Boilerplate

Every HTML file starts with this exact `<head>`:

```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PAGE_TITLE - AgriTrace</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: {
              50: '#F0FDF4', 100: '#DCFCE7', 200: '#BBF7D0', 300: '#86EFAC',
              400: '#4ADE80', 500: '#22C55E', 600: '#16A34A', 700: '#15803D',
              800: '#166534', 900: '#14532D'
            }
          },
          fontFamily: {
            sans: ['Inter', 'system-ui', 'sans-serif']
          }
        }
      }
    }
  </script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', system-ui, sans-serif; }
    .btn-primary {
      background: linear-gradient(135deg, #22C55E 0%, #16A34A 100%);
      color: white; border-radius: 8px; font-weight: 600;
      transition: all 0.2s;
    }
    .btn-primary:hover {
      background: linear-gradient(135deg, #16A34A 0%, #15803D 100%);
      box-shadow: 0 4px 12px rgba(22, 163, 74, 0.3);
    }
    .btn-outline {
      border: 1.5px solid #E2E8F0; background: white; color: #334155;
      border-radius: 8px; font-weight: 500; transition: all 0.2s;
    }
    .btn-outline:hover { border-color: #22C55E; color: #15803D; }
    .sidebar-link {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px; border-radius: 8px; color: #64748B;
      font-size: 14px; font-weight: 500; transition: all 0.15s;
      text-decoration: none;
    }
    .sidebar-link:hover { background: #F0FDF4; color: #15803D; }
    .sidebar-link.active {
      background: #F0FDF4; color: #15803D; font-weight: 600;
      border-right: 3px solid #15803D;
    }
    .card {
      background: white; border-radius: 12px;
      border: 1px solid #F1F5F9; box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .table-row:hover { background: #F8FAFC; }
    .timeline-line {
      position: absolute; left: 15px; top: 32px; bottom: 0;
      width: 2px; background: #DCFCE7;
    }
    .timeline-dot {
      width: 32px; height: 32px; border-radius: 50%;
      background: #F0FDF4; border: 2px solid #22C55E;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 600; color: #15803D;
      flex-shrink: 0; position: relative; z-index: 1;
    }
    .timeline-dot.completed { background: #22C55E; color: white; }
    .kpi-card {
      background: white; border-radius: 12px; padding: 20px;
      border: 1px solid #F1F5F9; box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center; z-index: 50;
    }
    .modal-content {
      background: white; border-radius: 16px; padding: 32px;
      max-width: 560px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.15);
    }
    /* Leaf decoration */
    .leaf-deco {
      position: absolute; opacity: 0.06; pointer-events: none;
    }
  </style>
</head>
```

## 2. Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| primary-700 | #15803D | Dark green text, sidebar active |
| primary-600 | #16A34A | Button gradient end |
| primary-500 | #22C55E | Main green, button gradient start, icons |
| primary-100 | #DCFCE7 | Light green bg for badges/highlights |
| primary-50 | #F0FDF4 | Very light green bg, sidebar active bg |
| slate-800 | #1E293B | Heading text |
| slate-600 | #475569 | Body text |
| slate-400 | #94A3B8 | Placeholder, muted text |
| slate-200 | #E2E8F0 | Borders |
| slate-100 | #F1F5F9 | Card borders, subtle bg |
| slate-50 | #F8FAFC | Page background (admin) |
| red-500 | #EF4444 | Error, danger, recall |
| amber-500 | #F59E0B | Warning |
| blue-500 | #3B82F6 | Info, in-transit |

## 3. State Badge Classes

```html
<!-- Production Cycle States -->
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">CREATED</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-600">PLANTED</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600">GROWING</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">COMPLETED</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-600">CANCELLED</span>

<!-- Lot States -->
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-600">HARVESTED</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-600">IN_TRANSPORT</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-600">ARRIVED</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-teal-50 text-teal-600">RETAIL_RECEIVED</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-600">FOR_SALE</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">SOLD</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-600">RECALLED</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-600">REJECTED</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">EXPIRED</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-orange-50 text-orange-600">DAMAGED</span>

<!-- Shipment Status (SEPARATE from Lot State) -->
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">CREATED</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-600">IN_TRANSIT</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-600">ARRIVED</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">DELIVERED</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-600">REJECTED</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">FAILED</span>

<!-- Verification -->
<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-600">
  <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
  VERIFIED
</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-600">⚠ INTEGRITY_WARNING</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-yellow-50 text-yellow-600">⏳ PROOF_PENDING</span>
<span class="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">BLOCKCHAIN_UNAVAILABLE</span>
```

## 4. Logo

```html
<a href="../public/home.html" class="flex items-center gap-2">
  <div class="w-9 h-9 bg-gradient-to-br from-primary-500 to-primary-700 rounded-lg flex items-center justify-center">
    <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2C9.5 2 7 4.5 5.5 8.5C4 12.5 6.5 18 9.5 21C11 18 12 14 12 10C12 14 13 18 14.5 21C17.5 18 20 12.5 18.5 8.5C17 4.5 14.5 2 12 2Z"/>
    </svg>
  </div>
  <div>
    <span class="text-xl font-bold"><span class="text-primary-700">Agri</span><span class="text-primary-500">Trace</span></span>
    <p class="text-[10px] text-slate-400 -mt-1">Minh bạch hôm nay</p>
  </div>
</a>
```

## 5. Public Header

```html
<header class="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-b border-slate-100 z-50">
  <div class="max-w-[1440px] mx-auto px-8 h-16 flex items-center justify-between">
    <!-- LOGO (see section 4) -->
    <nav class="hidden md:flex items-center gap-8">
      <a href="home.html" class="text-sm font-medium text-slate-600 hover:text-primary-600 transition">Trang chủ</a>
      <a href="#" class="text-sm font-medium text-slate-600 hover:text-primary-600 transition">Quy trình</a>
      <a href="#" class="text-sm font-medium text-slate-600 hover:text-primary-600 transition">Công nghệ</a>
      <a href="trace-search.html" class="text-sm font-medium text-slate-600 hover:text-primary-600 transition">Truy xuất</a>
      <a href="news-list.html" class="text-sm font-medium text-slate-600 hover:text-primary-600 transition">Tin tức</a>
    </nav>
    <div class="flex items-center gap-3">
      <a href="login.html" class="btn-outline px-4 py-2 text-sm">Đăng nhập</a>
      <a href="trace-search.html" class="btn-primary px-4 py-2 text-sm inline-flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/></svg>
        Quét mã QR
      </a>
    </div>
  </div>
</header>
<!-- Add pt-16 to body/main content to offset fixed header -->
```

## 6. Public Footer

```html
<footer class="bg-slate-800 text-slate-300 mt-20">
  <div class="max-w-[1440px] mx-auto px-8 py-12">
    <div class="grid grid-cols-4 gap-8 mb-8">
      <div>
        <!-- Logo white variant -->
        <div class="flex items-center gap-2 mb-4">
          <div class="w-9 h-9 bg-primary-500 rounded-lg flex items-center justify-center">
            <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C9.5 2 7 4.5 5.5 8.5C4 12.5 6.5 18 9.5 21C11 18 12 14 12 10C12 14 13 18 14.5 21C17.5 18 20 12.5 18.5 8.5C17 4.5 14.5 2 12 2Z"/></svg>
          </div>
          <span class="text-lg font-bold text-white">AgriTrace</span>
        </div>
        <p class="text-sm text-slate-400">Minh bạch hôm nay,<br>vì nông sản sạch ngày mai.</p>
      </div>
      <div>
        <h4 class="font-semibold text-white mb-3 text-sm">Về AgriTrace</h4>
        <ul class="space-y-2 text-sm"><li><a href="#" class="hover:text-white transition">Giới thiệu</a></li><li><a href="news-list.html" class="hover:text-white transition">Tin tức</a></li><li><a href="#" class="hover:text-white transition">Câu hỏi thường gặp</a></li></ul>
      </div>
      <div>
        <h4 class="font-semibold text-white mb-3 text-sm">Hỗ trợ</h4>
        <ul class="space-y-2 text-sm"><li><a href="#" class="hover:text-white transition">Hướng dẫn sử dụng</a></li><li><a href="#" class="hover:text-white transition">Chính sách bảo mật</a></li><li><a href="#" class="hover:text-white transition">Điều khoản dịch vụ</a></li></ul>
      </div>
      <div>
        <h4 class="font-semibold text-white mb-3 text-sm">Kết nối với chúng tôi</h4>
        <div class="flex gap-3 mt-3">
          <a href="#" class="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center hover:bg-primary-600 transition"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 4.6c-.9.4-1.8.7-2.8.8 1-.6 1.8-1.6 2.2-2.7-1 .6-2 1-3.1 1.2C19.3 2.7 18 2 16.6 2c-2.6 0-4.7 2.1-4.7 4.7 0 .4 0 .7.1 1.1C7.7 7.6 4.1 5.7 1.7 2.9c-.4.7-.6 1.6-.6 2.5 0 1.6.8 3.1 2.1 3.9-.8 0-1.5-.2-2.1-.6v.1c0 2.3 1.6 4.2 3.8 4.6-.4.1-.8.2-1.3.2-.3 0-.6 0-.9-.1.6 2 2.4 3.4 4.6 3.4-1.7 1.3-3.8 2.1-6.1 2.1-.4 0-.8 0-1.2-.1 2.2 1.4 4.8 2.2 7.5 2.2 9.1 0 14-7.5 14-14v-.6c1-.7 1.8-1.6 2.5-2.5z"/></svg></a>
          <a href="#" class="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center hover:bg-primary-600 transition"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12c0 5 3.7 9.1 8.4 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.3v7C18.3 21.1 22 17 22 12c0-5.5-4.5-10-10-10z"/></svg></a>
          <a href="#" class="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center hover:bg-primary-600 transition"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M19.6 3H4.4C3.6 3 3 3.6 3 4.4v15.1c0 .9.6 1.5 1.4 1.5h15.1c.9 0 1.5-.6 1.5-1.4V4.4c0-.8-.6-1.4-1.4-1.4zM8.3 18.3H5.7V9.7h2.6v8.6zM7 8.6c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5-.7 1.5-1.5 1.5zm11.3 9.7h-2.6v-4.2c0-1-.4-1.7-1.3-1.7-.7 0-1.1.5-1.3 1-.1.2-.1.4-.1.6v4.3h-2.6V9.7H13v1.2c.3-.6 1-1.4 2.3-1.4 1.7 0 3 1.1 3 3.4v5.4z"/></svg></a>
        </div>
        <p class="mt-4 text-xs text-slate-500">Nông sản Việt<br>Cho cuộc sống xanh hơn</p>
      </div>
    </div>
    <div class="border-t border-slate-700 pt-6 flex justify-between items-center text-xs text-slate-500">
      <p>© 2026 AgriTrace. Tất cả quyền được bảo lưu.</p>
      <p>Nông sản Việt – Giá trị thật, niềm tin thật.</p>
    </div>
  </div>
</footer>
```

## 7. Admin Sidebar

```html
<aside class="fixed left-0 top-0 bottom-0 w-64 bg-white border-r border-slate-100 z-40 flex flex-col">
  <!-- Logo -->
  <div class="h-16 px-5 flex items-center border-b border-slate-100">
    <!-- LOGO from section 4 -->
  </div>
  <!-- Menu -->
  <nav class="flex-1 overflow-y-auto py-4 px-3 space-y-1">
    <p class="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Tổng quan</p>
    <a href="dashboard.html" class="sidebar-link active" data-page="dashboard">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4"/></svg>
      Tổng quan
    </a>

    <p class="px-3 mt-5 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Sản xuất</p>
    <a href="cycles-list.html" class="sidebar-link" data-page="cycles">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
      Vụ trồng
    </a>
    <a href="iot.html" class="sidebar-link" data-page="iot">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
      IoT & Sensor
    </a>

    <p class="px-3 mt-5 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Hàng hóa</p>
    <a href="lots-list.html" class="sidebar-link" data-page="lots">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
      Lô sản phẩm
    </a>
    <a href="shipments-list.html" class="sidebar-link" data-page="shipments">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"/></svg>
      Shipment
    </a>
    <a href="retail.html" class="sidebar-link" data-page="retail">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>
      Bán lẻ
    </a>

    <p class="px-3 mt-5 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Chất lượng</p>
    <a href="quality.html" class="sidebar-link" data-page="quality">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
      Chứng nhận
    </a>
    <a href="audit.html" class="sidebar-link" data-page="audit">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
      Audit / Blockchain
    </a>

    <p class="px-3 mt-5 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Nội dung</p>
    <a href="news-admin.html" class="sidebar-link" data-page="news">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"/></svg>
      Tin tức
    </a>

    <p class="px-3 mt-5 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Hệ thống</p>
    <a href="master-data.html" class="sidebar-link" data-page="master">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
      Quản trị dữ liệu
    </a>
  </nav>
  <!-- Bottom -->
  <div class="px-5 py-4 border-t border-slate-100">
    <p class="text-[10px] text-slate-400">Kết nối nông sản Việt<br>Tạo giá trị bền vững</p>
  </div>
</aside>
```

## 8. Admin Topbar

```html
<header class="fixed top-0 left-64 right-0 h-16 bg-white border-b border-slate-100 z-30 flex items-center justify-between px-6">
  <!-- Left: Breadcrumb -->
  <div class="flex items-center gap-2 text-sm">
    <span class="text-slate-400">Admin</span>
    <svg class="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
    <span class="text-slate-700 font-medium">PAGE_NAME</span>
  </div>
  <!-- Right: Search + Alerts + Profile -->
  <div class="flex items-center gap-4">
    <div class="relative">
      <input type="text" placeholder="Tìm kiếm sản phẩm, lô, mã QR..." class="w-72 pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400">
      <svg class="absolute left-3 top-2.5 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
    </div>
    <button class="relative p-2 text-slate-400 hover:text-slate-600 transition">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
      <span class="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
    </button>
    <div class="flex items-center gap-3 pl-4 border-l border-slate-200">
      <div class="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-semibold text-sm">A</div>
      <div class="text-sm"><p class="font-medium text-slate-700">Admin</p><p class="text-xs text-slate-400">Quản trị viên</p></div>
    </div>
  </div>
</header>
```

## 9. Admin Page Wrapper

```html
<body class="bg-slate-50">
  <!-- Sidebar (section 7) -->
  <!-- Topbar (section 8) -->
  <main class="ml-64 pt-16 min-h-screen">
    <div class="p-6">
      <!-- PAGE CONTENT HERE -->
    </div>
  </main>
</body>
```

## 10. Component: KPI Card

```html
<div class="kpi-card flex items-start gap-4">
  <div class="w-12 h-12 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
    <svg class="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><!-- icon --></svg>
  </div>
  <div>
    <p class="text-2xl font-bold text-slate-800">12</p>
    <p class="text-sm text-slate-500 mt-0.5">Vụ đang hoạt động</p>
    <p class="text-xs text-green-600 mt-1 flex items-center gap-1">
      <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z"/></svg>
      +2 so với tuần trước
    </p>
  </div>
</div>
```

## 11. Component: Data Table

```html
<div class="card overflow-hidden">
  <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
    <h3 class="font-semibold text-slate-800">TABLE_TITLE</h3>
    <a href="#" class="text-sm text-primary-600 hover:text-primary-700 font-medium">Xem tất cả →</a>
  </div>
  <table class="w-full">
    <thead>
      <tr class="bg-slate-50 text-left">
        <th class="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Column</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-slate-100">
      <tr class="table-row transition">
        <td class="px-6 py-4 text-sm text-slate-700">Data</td>
      </tr>
    </tbody>
  </table>
</div>
```

## 12. Component: Timeline Event

```html
<div class="relative pl-12">
  <div class="timeline-line"></div>
  <div class="flex gap-4 pb-8">
    <div class="timeline-dot completed">1</div>
    <div class="flex-1 pt-1">
      <div class="flex items-center justify-between mb-1">
        <h4 class="font-semibold text-slate-800 text-sm">Gieo trồng</h4>
        <span class="text-xs text-slate-400">12/01/2026 08:30</span>
      </div>
      <p class="text-sm text-slate-500">Nông trại An Phú · Huyện Củ Chi, TP. HCM</p>
      <p class="text-xs text-slate-400 mt-1">Mã giao dịch blockchain: 0x3a7f...9c21</p>
      <span class="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-600">
        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>
        Đã xác thực
      </span>
    </div>
  </div>
</div>
```

## 13. Navigation Links (relative paths)

From `public/` files, link to other public files as `./filename.html` and admin as `../admin/filename.html`.
From `admin/` files, link to other admin files as `./filename.html` and public as `../public/filename.html`.
Index at `../index.html`.

## 14. Standard Mock Data

| Entity | Values |
|--------|--------|
| Farms | Nông trại An Phú, HTX GreenFarm, Trang trại Việt, Nông trại Phú Hòa |
| Products | Rau cải xanh, Cà chua, Dưa lưới, Ớt chuông, Rau cải bó xôi |
| Lot codes | LOT-2026-0001 through LOT-2026-0008 |
| Cycle codes | CYC-2026-001 through CYC-2026-005 |
| Shipment IDs | SH-2026-001 through SH-2026-005 |
| Transporters | GreenTrans Logistics, VietFarm Express |
| Retailers | FreshMart Quận 7, VinMart Bình Thạnh, CoopMart Gò Vấp |
| Dates | Use March–April 2026 range |
| Quantities | 100-500 kg |
| Trace tokens | AT000123456, AT000234567 |

## 15. Page Width

All pages designed at **1440px** viewport. Use `max-w-[1440px] mx-auto` for public pages. Admin content area fills remaining space after 256px sidebar.
