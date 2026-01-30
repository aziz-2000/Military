// pages/Research.jsx - البحث العلمي
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

export default function Research() {
  return (
    <>
      <Navbar />
      <div className="container" style={styles.page}>
        <h1 style={styles.title}>البحث العلمي</h1>
        <p style={styles.content}>
          مرحباً بكم في قسم البحث العلمي بكلية السلطان قابوس العسكرية. يمكنكم الاطلاع على
          أبرز المشاريع البحثية والدراسات والمشاركة في تطوير المعرفة.
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
