// components/Commander.jsx
// يمكنك استبدال هذا المسار بصورة آمر الكلية
// import commanderImage from "../assets/commander.jpg";

export default function Commander() {
  return (
    <section style={styles.section}>
      <div className="container" style={styles.container}>
        <div style={styles.content}>
          <div style={styles.imageWrapper}>
            {/* يمكنك إضافة الصورة هنا عندما تتوفر */}
            <div style={styles.placeholderImage}>
              <span style={styles.placeholderText}>صورة آمر الكلية</span>
            </div>
            {/* <img src={commanderImage} alt="آمر الكلية" style={styles.image} /> */}
          </div>
          <div style={styles.textWrapper}>
            <h2 style={styles.title}>آمر الكلية</h2>
            <p style={styles.description}>
              نرحب بكم في كلية السلطان قابوس العسكرية، حيث نسعى لتخريج قادة متميزين
              يتحلون بالعلم والعمل الجاد والانضباط العسكري.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const styles = {
  section: {
    background: "#fff",
    padding: "40px 0",
    borderTop: "1px solid #e5e5e5"
  },
  container: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center"
  },
  content: {
    display: "flex",
    alignItems: "center",
    gap: "30px",
    maxWidth: "900px",
    width: "100%"
  },
  imageWrapper: {
    flexShrink: 0
  },
  placeholderImage: {
    width: "200px",
    height: "250px",
    background: "#f0f0f0",
    borderRadius: "12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "2px dashed #ccc"
  },
  placeholderText: {
    color: "#999",
    fontSize: "14px"
  },
  image: {
    width: "200px",
    height: "250px",
    objectFit: "cover",
    borderRadius: "12px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
  },
  textWrapper: {
    flex: 1
  },
  title: {
    fontSize: "28px",
    fontWeight: "bold",
    color: "#1e1e1e",
    marginBottom: "15px",
    marginTop: 0
  },
  description: {
    fontSize: "16px",
    lineHeight: "1.8",
    color: "#555",
    margin: 0
  }
};

