export function eventSummary(eventType: string) {
  const summaries: Record<string, string> = {
    PRODUCTION_CYCLE_CREATED: 'Khởi tạo chu kỳ sản xuất.',
    CYCLE_PLANTED: 'Ghi nhận gieo trồng.',
    CARE_RECORDED: 'Ghi nhận hoạt động chăm sóc.',
    SENSOR_READING_RECORDED: 'Ghi nhận dữ liệu cảm biến.',
    HARVEST_RECORDED: 'Ghi nhận thu hoạch và tạo lô.',
    SHIPMENT_CREATED: 'Tạo chuyến vận chuyển.',
    SHIPMENT_STARTED: 'Bắt đầu vận chuyển.',
    SHIPMENT_ARRIVED: 'Lô hàng đã đến nơi nhận.',
    SHIPMENT_RECEIVED: 'Nhà bán lẻ đã nhận lô hàng.',
    SHIPMENT_REJECTED: 'Nhà bán lẻ từ chối lô hàng.',
    SHIPMENT_DAMAGE_RECORDED: 'Ghi nhận hàng hư hỏng.',
    SENSOR_DIGEST_CREATED: 'Chốt bản tổng hợp dữ liệu cảm biến.',
    SHIPMENT_TELEMETRY_DIGEST_CREATED: 'Chốt bản tổng hợp dữ liệu vận chuyển.',
    INSPECTION_RECORDED: 'Ghi nhận kết quả thanh tra.',
    CERTIFICATE_SUBMITTED: 'Gửi chứng chỉ để xét duyệt.',
    CERTIFICATE_APPROVED: 'Chứng chỉ đã được phê duyệt.',
    CERTIFICATE_REJECTED: 'Chứng chỉ bị từ chối.',
  };
  return summaries[eventType] ?? eventType.replaceAll('_', ' ').toLowerCase();
}
