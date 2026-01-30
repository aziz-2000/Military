// pages/About.jsx
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

export default function About() {
  return (
    <>
      <Navbar />
      <div className="container" style={styles.page}>
        <h1 style={styles.title}>عن الكلية</h1>
        <p style={styles.content}>
          كلية السلطان قابوس العسكرية هي مؤسسة تعليمية عسكرية رائدة تهدف إلى إعداد وتأهيل الضباط
          العسكريين على أعلى المستويات الأكاديمية والعسكرية.
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

