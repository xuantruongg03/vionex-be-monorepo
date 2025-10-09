# 🎯 SFU Stream Priority Logic Documentation

## 📊 Overview

Hệ thống ưu tiên stream được thiết kế để tối ưu băng thông trong các phòng họp lớn, đảm bảo trải nghiệm tốt nhất cho người dùng quan trọng nhất.

## 🔢 Configuration Constants

Tất cả constants được định nghĩa trong `src/constants/sfu.constants.ts`:

| Constant | Giá Trị | Mô Tả |
|----------|---------|--------|
| `SMALL_ROOM_MAX_USERS` | 10 | Ngưỡng phòng nhỏ - không áp dụng giới hạn |
| `MAX_PRIORITY_USERS` | 10 | Số lượng users tối đa trong priority list |
| `SPEAKING_THRESHOLD_MS` | 5000ms | Thời gian coi user đang speaking |
| `SPEAKER_CLEANUP_INTERVAL_MS` | 5000ms | Interval dọn dẹp speakers không active |
| `CONSUMER_THRESHOLD` | 20 | Ngưỡng consumers tối đa mỗi room |

## 🎯 Priority Levels

### Phòng Nhỏ (≤ 10 users)
- ✅ **TẤT CẢ users consume TẤT CẢ streams**
- Không có giới hạn, băng thông đủ cho mọi người

### Phòng Lớn (> 10 users)

#### Priority 0: 👤 **Pinned Users** (Highest)
- **Điều kiện:** User được ghim bởi người khác
- **Giới hạn:** Unlimited
- **Logic:** Luôn được consume, không bị ảnh hưởng bởi bất kỳ giới hạn nào
- **Use case:** Host muốn luôn nhìn thấy một user cụ thể

#### Priority 1: 🎤 **Speaking Users**
- **Điều kiện:** User đang speaking (trong vòng 5 giây gần nhất)
- **Giới hạn:** Unlimited
- **Logic:** Bypass tất cả giới hạn, luôn được consume
- **Use case:** Người đang nói cần được mọi người nhìn thấy

#### Priority 2: 🖥️ **Special Users**
- **Điều kiện:** 
  - Screen sharing
  - Translation cabin users
  - (Có thể mở rộng: creators, admins)
- **Giới hạn:** Unlimited
- **Logic:** Luôn được ưu tiên cao
- **Use case:** Screen share cần được xem bởi tất cả

#### Priority 3: 👥 **Regular Priority Users**
- **Điều kiện:** Top N users theo FIFO (First In First Out)
- **Giới hạn:** MAX_PRIORITY_USERS (10 users)
- **Logic:** 
  - Chọn users dựa trên thứ tự tạo stream
  - Stream cũ hơn → Priority cao hơn
  - Users join trước → được ưu tiên
- **Use case:** 10 người đầu tiên join phòng

#### Priority 4: ❌ **Other Users**
- **Điều kiện:** Users còn lại (không thuộc các priority trên)
- **Giới hạn:** Không được consume
- **Logic:** Bị từ chối consume trừ khi:
  - Speaking
  - Được ghim
  - Trở thành special user

## 🔄 Flow Chart

```
User Request Consume Stream
    |
    ├─> Check: Is Pinned? ──────────────────────> ✅ CONSUME (Priority 0)
    |        └─> NO
    |
    ├─> Check: Room Size ≤ 10? ─────────────────> ✅ CONSUME (Small Room)
    |        └─> NO (Large Room >10)
    |
    ├─> Check: Is Speaking? ────────────────────> ✅ CONSUME (Priority 1)
    |        └─> NO
    |
    ├─> Check: Is Special User? ────────────────> ✅ CONSUME (Priority 2)
    |        └─> NO
    |
    ├─> Check: In Top 10 Priority List? ────────> ✅ CONSUME (Priority 3)
    |        └─> NO
    |
    └─> ❌ REJECT (Not in Priority)
```

## 📝 Key Functions

### `shouldUserReceiveStream(roomId, consumerId, publisherId)`
**Mục đích:** Quyết định consumer có được consume stream từ publisher hay không

**Input:**
- `roomId`: ID phòng
- `consumerId`: ID người muốn consume
- `publisherId`: ID người đang publish

**Output:** `boolean` - true/false

**Logic Flow:**
1. Check Pinned → return true
2. Check Room Size ≤ 10 → return true
3. Check Speaking → return true
4. Check Special User → return true
5. Check Priority List → return true
6. Else → return false

### `getPrioritizedUsers(roomId)`
**Mục đích:** Lấy danh sách users được ưu tiên trong phòng lớn

**Output:** `Set<string>` - Set các userIds

**Logic Flow:**
1. Add all speaking users (unlimited)
2. Add all special users (unlimited)
3. Fill remaining slots up to MAX_PRIORITY_USERS
   - Sort streams by age (FIFO)
   - Take top N users

## 🎮 Examples

### Example 1: Phòng 5 users
```
Users: A, B, C, D, E
Result: Tất cả consume lẫn nhau (phòng nhỏ)
```

### Example 2: Phòng 15 users, không ai speaking
```
Users: A, B, C, D, E, F, G, H, I, J, K, L, M, N, O
Priority List: Top 10 (A-J)
Result:
- A-J: Consume lẫn nhau ✅
- K-O: Không consume ai (trừ khi speaking/pinned) ❌
```

### Example 3: Phòng 15 users, K đang speaking
```
Users: A, B, C, D, E, F, G, H, I, J, K (speaking), L, M, N, O
Priority List: A-J + K (speaking)
Result:
- A-K: Consume lẫn nhau ✅
- L-O: Không consume ai ❌
- Mọi người consume K vì K đang speaking
```

### Example 4: Phòng 15 users, O được pin bởi A
```
Users: A, B, ..., O
A pins O
Result:
- A consume O (vì pinned) ✅
- O không trong top 10 nhưng A vẫn nhìn thấy
```

## 🔧 Configuration Guide

### Tăng số lượng priority users
```typescript
// In src/constants/sfu.constants.ts
export const MAX_PRIORITY_USERS = 20; // Tăng từ 10 lên 20
```

### Tăng ngưỡng phòng nhỏ
```typescript
// In src/constants/sfu.constants.ts
export const SMALL_ROOM_MAX_USERS = 15; // Tăng từ 10 lên 15
```

### Điều chỉnh speaking threshold
```typescript
// In src/constants/sfu.constants.ts
export const SPEAKING_THRESHOLD_MS = 3000; // Giảm từ 5s xuống 3s
```

## 🐛 Debugging

### Logs quan trọng

```typescript
[SFU PRIORITY] Small room (5/10) → all consume
[SFU PRIORITY] Pinned user alice → consume (Priority 0: Pinned)
[SFU PRIORITY] Speaking user bob → consume (Priority 1: Speaking)
[SFU PRIORITY] Special user charlie → consume (Priority 2: Special)
[SFU PRIORITY] Priority user dave → consume (Priority 3: Top 10)
[SFU PRIORITY] User eve → NOT consume (not in priority, room: 15 users)
[SFU PRIORITY] Room room123: 11 prioritized users (max: 10)
```

## 📊 Performance Considerations

### Băng thông tiết kiệm
- Phòng 50 users without limit: 50 × 49 = 2450 connections
- Phòng 50 users with limit (10): ~10 × 49 + 40 × 10 = ~890 connections
- Tiết kiệm: ~64% băng thông

### CPU Usage
- getPrioritizedUsers() chạy mỗi lần consume request
- O(n) complexity với n = số streams trong room
- Optimized với Set và Map lookups

## 🚀 Future Improvements

1. **Dynamic Priority Adjustment**
   - Tự động điều chỉnh MAX_PRIORITY_USERS dựa trên bandwidth
   
2. **Room Creator Priority**
   - Tự động ưu tiên người tạo phòng

3. **Time-based Priority**
   - Users speaking nhiều → priority cao hơn

4. **Bandwidth-aware Priority**
   - Tự động giảm priority users khi bandwidth thấp

## 📚 Related Files

- `src/constants/sfu.constants.ts` - Configuration constants
- `src/sfu.service.ts` - Main SFU service logic
- `src/interface.ts` - Type definitions
