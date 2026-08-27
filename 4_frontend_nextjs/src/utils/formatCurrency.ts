export const formatCurrency = (value: number, currency = "VND") => new Intl.NumberFormat("vi-VN", { style: "currency", currency }).format(value);
