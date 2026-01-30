// components/QuickLinks.jsx
import { 
  FaGraduationCap, 
  FaEnvelope, 
  FaBookOpen, 
  FaClipboardList, 
  FaDoorOpen, 
  FaUtensils, 
  FaLaptopCode, 
  FaExclamationCircle 
} from "react-icons/fa";

const links = [
  { name: "التعلم الإلكتروني", icon: FaGraduationCap },
  { name: "البريد الإلكتروني", icon: FaEnvelope },
  { name: "مركز مصادر التعلم", icon: FaBookOpen },
  { name: "الاختبارات", icon: FaClipboardList },
  { name: "بوابتي", icon: FaDoorOpen },
  { name: "نظام الإعاشة", icon: FaUtensils },
  { name: "خدمات تقنية المعلومات", icon: FaLaptopCode },
  { name: "نظام الاستجابة السريعة", icon: FaExclamationCircle }
];

export default function QuickLinks() {
  return (
    <section className="container" style={styles.grid}>
      {links.map((item) => (
        <div key={item.name} style={styles.card}>
          <item.icon style={styles.icon} />
          <span style={styles.text}>{item.name}</span>
        </div>
      ))}
    </section>
  );
}

const styles = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
    gap: "20px",
    marginTop: "40px",
    marginBottom: "40px",
    padding: "0 20px"
  },
  card: {
    background: "#fff",
    padding: "25px",
    textAlign: "center",
    borderRadius: "16px",
    boxShadow: "0 8px 20px rgba(0,0,0,0.1)",
    fontWeight: "500",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "15px",
    transition: "transform 0.2s, boxShadow 0.2s"
  },
  icon: {
    fontSize: "40px",
    color: "rgba(181,155,42,0.95)"

  },
  text: {
    fontSize: "14px"
  }
};
