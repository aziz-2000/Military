// pages/Services.jsx
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

export default function Services() {
  return (
    <>
      <Navbar />
      <div className="container" style={styles.page}>
        <h1 style={styles.title}>خدمات الطلبة</h1>
        <p style={styles.content}>
          قسم خدمات الطلبة يقدم مجموعة متنوعة من الخدمات للطلاب والضباط المرشحين، بما في ذلك
          الخدمات الأكاديمية والإدارية والاجتماعية.
        </p>
        <div style={styles.cardsGrid}>
          <div style={styles.card} className="service-card">التعلم الإلكتروني</div>
          <div style={styles.card} className="service-card">البريد الإلكتروني</div>
          <div style={styles.card} className="service-card">مركز مصادر التعلم</div>
          <div style={styles.card} className="service-card">الاختبارات</div>
          <Link to="/student-portal" style={{ textDecoration: "none" }}>
            <div style={styles.card} className="service-card">بوابتي</div>
          </Link>
          <div style={styles.card} className="service-card">نظام الإعاشة</div>
          <div style={styles.card} className="service-card">خدمات تقنية المعلومات</div>
          <div style={styles.card} className="service-card">نظام الاستجابة السريعة</div>
        </div>
        <style>{cardHoverStyle}</style>
      </div>
      <Footer />
    </>
  );
}

const styles = {
  page: {
    minHeight: "60vh",
    padding: "60px 20px"
  },
  title: {
    color: "var(--primary)",
    fontSize: "32px",
    marginBottom: "20px"
  },
  content: {
    fontSize: "18px",
    lineHeight: "1.8",
    color: "#555"
  },
  cardsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "24px",
    marginTop: "36px"
  },
  card: {
    background: "#fff",
    padding: "28px 24px",
    borderRadius: "12px",
    fontSize: "18px",
    fontWeight: "600",
    color: "#1e1e1e",
    boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
    border: "1px solid #eee",
    textAlign: "center",
    transition: "box-shadow 0.3s ease, transform 0.2s ease"
  }
};

const cardHoverStyle = `
  .service-card:hover {
    box-shadow: 0 8px 30px rgba(181, 155, 42, 0.2);
    transform: translateY(-4px);
    border-color: var(--primary);
  }
`;

