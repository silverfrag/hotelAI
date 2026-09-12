import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  async processMessage(userId: string | undefined, message: string): Promise<string> {
    this.logger.log(`Received message from user \${userId || 'guest'}: \${message}`);

    const lowerMsg = message.toLowerCase();
    
    // Simulate slight delay for AI processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (lowerMsg.includes('phòng') || lowerMsg.includes('room') || lowerMsg.includes('giá') || lowerMsg.includes('price')) {
      return "Chúng tôi có nhiều loại phòng đa dạng như Deluxe, Suite và Villa. Giá phòng dao động từ 2,000,000 VND đến 10,000,000 VND mỗi đêm tùy theo loại phòng và ngày đặt. Bạn có muốn xem thêm chi tiết trên lịch đặt phòng không?";
    }

    if (lowerMsg.includes('wifi') || lowerMsg.includes('internet')) {
      return "Khách sạn cung cấp Wi-Fi miễn phí tốc độ cao tại tất cả các phòng và khu vực công cộng. Mật khẩu Wi-Fi sẽ được cung cấp khi bạn nhận phòng.";
    }
    
    if (lowerMsg.includes('hủy') || lowerMsg.includes('cancel')) {
      return "Chính sách hủy phòng của chúng tôi cho phép bạn hủy miễn phí trước 24 giờ so với giờ nhận phòng. Nếu bạn hủy trễ hơn, phí hủy có thể áp dụng.";
    }

    if (lowerMsg.includes('nhà hàng') || lowerMsg.includes('restaurant') || lowerMsg.includes('ăn')) {
      return "Chúng tôi có 3 nhà hàng đạt chuẩn quốc tế phục vụ các món ăn Việt Nam và phương Tây. Bữa sáng buffet được phục vụ từ 6:00 sáng đến 10:00 sáng hàng ngày.";
    }

    if (lowerMsg.includes('bể bơi') || lowerMsg.includes('pool') || lowerMsg.includes('spa')) {
      return "Khu nghỉ dưỡng của chúng tôi có hồ bơi vô cực mở cửa từ 6:00 sáng đến 8:00 tối. Spa của chúng tôi cung cấp các liệu pháp thư giãn, vui lòng đặt lịch trước với lễ tân.";
    }

    return "Cảm ơn bạn đã nhắn tin. Tôi là trợ lý ảo của Hotel AI. Hiện tại tôi đang trong giai đoạn thử nghiệm. Vui lòng liên hệ lễ tân hoặc để lại yêu cầu cụ thể hơn, tôi sẽ cố gắng hỗ trợ tốt nhất!";
  }
}
