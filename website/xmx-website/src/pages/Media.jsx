// pages/Media.jsx
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

export default function Media() {
  return (
    <>
      <Navbar />
      <div className="container" style={styles.page}>
        <h1 style={styles.title}>المركز الإعلامي</h1>
        <p style={styles.content}>
          المركز الإعلامي يغطي جميع الأخبار والفعاليات والأنشطة التي تقام في الكلية، بالإضافة إلى
          التواصل مع وسائل الإعلام المختلفة.
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

