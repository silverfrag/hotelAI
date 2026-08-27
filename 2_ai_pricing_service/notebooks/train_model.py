import pandas as pd
import os
import joblib
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error

# Đảm bảo đường dẫn tuyệt đối để không bị lỗi khi chạy từ các thư mục khác nhau
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, "hotel_bookings.csv")
MODEL_OUTPUT_PATH = os.path.join(BASE_DIR, "../app/models/random_forest_v1.pkl")

def load_and_filter_data(filepath: str) -> pd.DataFrame:
    """Đọc dữ liệu và lọc riêng biệt City Hotel"""
    df = pd.read_csv(filepath)
    # Lọc lấy khách sạn thành phố và các đơn đặt phòng không bị hủy
    city_hotel_df = df[(df['hotel'] == 'City Hotel') & (df['is_canceled'] == 0)].copy()
    return city_hotel_df

def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Trích xuất đặc trưng và tính toán hệ số giá (Multiplier)"""
    # Ánh xạ tháng bằng chữ sang số
    month_map = {
        'January': 1, 'February': 2, 'March': 3, 'April': 4,
        'May': 5, 'June': 6, 'July': 7, 'August': 8,
        'September': 9, 'October': 10, 'November': 11, 'December': 12
    }
    df['arrival_month'] = df['arrival_date_month'].map(month_map)
    
    # Tạo feature cuối tuần: 1 nếu có ở đêm cuối tuần, 0 nếu không
    df['is_weekend'] = (df['stays_in_weekend_nights'] > 0).astype(int)
    
    # Mục tiêu của AI không phải đoán giá tiền tệ (vì mỗi loại phòng giá khác nhau),
    # mà là đoán HỆ SỐ NHÂN (Multiplier). 
    # Ta giả định giá gốc (Base Price) là giá trung vị của toàn bộ tập dữ liệu.
    base_price = df['adr'].median()
    
    # Tính hệ số giá thực tế (Loại bỏ các trường hợp adr <= 0 do lỗi dữ liệu Kaggle)
    valid_adr_df = df[df['adr'] > 0].copy()
    valid_adr_df['price_multiplier'] = valid_adr_df['adr'] / base_price
    
    # Cắt biên an toàn cho dữ liệu train (Hệ số từ 0.5 đến 3.0)
    valid_adr_df['price_multiplier'] = valid_adr_df['price_multiplier'].clip(lower=0.5, upper=3.0)
    
    # Chọn lọc các cột đầu vào (X) và đầu ra (y)
    features = ['lead_time', 'arrival_month', 'is_weekend', 'total_of_special_requests']
    target = 'price_multiplier'
    
    return valid_adr_df[features + [target]]

def train_and_evaluate(df: pd.DataFrame):
    """Phân tách dữ liệu, huấn luyện Random Forest và đánh giá"""
    X = df.drop(columns=['price_multiplier'])
    y = df['price_multiplier']
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    # Khởi tạo mô hình Random Forest Regressor
    model = RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42, n_jobs=-1)
    
    print("Đang huấn luyện mô hình AI (có thể mất vài chục giây)...")
    model.fit(X_train, y_train)
    
    # Đánh giá độ sai số
    predictions = model.predict(X_test)
    mae = mean_absolute_error(y_test, predictions)
    print(f"Huấn luyện thành công! Sai số tuyệt đối trung bình (MAE): {mae:.4f}")
    
    return model

def save_model(model, output_path: str):
    """Đóng gói mô hình thành file .pkl"""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    joblib.dump(model, output_path)
    print(f"Đã lưu mô hình sẵn sàng cho API tại: {output_path}")

def run_pipeline():
    print("Bắt đầu luồng xử lý dữ liệu Kaggle...")
    raw_data = load_and_filter_data(DATA_PATH)
    processed_data = engineer_features(raw_data)
    trained_model = train_and_evaluate(processed_data)
    save_model(trained_model, MODEL_OUTPUT_PATH)

if __name__ == "__main__":
    run_pipeline()