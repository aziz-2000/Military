// pages/Academics.jsx
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

export default function Academics() {
  return (
    <>
      <Navbar />
      <div className="container" style={styles.page}>
        <h1 style={styles.title}>الشؤون الأكاديمية</h1>
        <p style={styles.content}>
          قسم الشؤون الأكاديمية يهتم بجميع الأمور المتعلقة بالبرامج الدراسية والمناهج التعليمية
          والأنشطة الأكاديمية في الكلية.
        </p>
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
  }
};

