# Hoalu OpenCollection

[English](README.md)

## Giới thiệu

**@hoalulab/opencollection** là bộ sưu tập OpenAPI của các công ty chứng khoán/nền tảng giao dịch tài chính Việt Nam.

## Cấu trúc dự án

Dự án được tổ chức thành ba phần chính:

```text
.
|-- collections/  # `opencollection`: Định dạng OpenCollection do Bruno đề xuất
|-- openapi/      # Các đặc tả OpenAPI cho REST API
|-- asyncapi/     # Các đặc tả AsyncAPI cho API thời gian thực và WebSocket
```

### Tài nguyên chính thức dành cho nhà phát triển

#### Các công ty chứng khoán

- **DNSE** — https://developers.dnse.com.vn/docs/guide/intro/api_platform
- **Entrade** — https://hdsd2.entrade.com.vn/entrade-api
- **FHSC** — https://developers.fhsc.com.vn/introduction
- **SSI** — https://developers.ssi.com.vn/docs/api-reference
- **TCBS** — https://developers.tcbs.com.vn/docs/v1.0.0/introduction

#### Các công ty / nền tảng giao dịch tài chính khác

- **FireAnt** (Shinhan/Fmarket) — https://api.fireant.vn

#### Tài nguyên phát triển tham khảo khác

- **Bruno** — https://docs.usebruno.com
- **OpenAPI Specification** — https://spec.openapis.org/oas/v3.1.0
- **AsyncAPI Specification** — https://www.asyncapi.com/docs/specifications/3.0.0
- **Hoalu Mintlify Documentation** — https://hoalulab.mintlify.app / https://hoalulab.mintlify.site

## Miễn trừ trách nhiệm

Dự án này chỉ được cung cấp cho mục đích tham khảo kỹ thuật và phát triển. Đây không phải là tư vấn tài chính, đầu tư, pháp lý, thuế hoặc giao dịch. API, dữ liệu, quy trình xác thực và yêu cầu của công ty chứng khoán có thể thay đổi mà không báo trước. Bạn tự chịu rủi ro khi sử dụng dự án này và cần kiểm tra mọi request, response và thao tác giao dịch với tài liệu chính thức của công ty chứng khoán trước khi dùng với tài khoản thật hoặc hệ thống production.

Nhóm duy trì dự án không chịu trách nhiệm cho bất kỳ tổn thất, thiệt hại, lệnh sai, lệnh thất bại, vấn đề tài khoản, lỗi dữ liệu, gián đoạn dịch vụ hoặc hậu quả nào khác phát sinh từ việc sử dụng dự án này.

## License

Dự án này được cấp phép theo Apache License 2.0. Xem [LICENSE](LICENSE) để biết thêm chi tiết.
