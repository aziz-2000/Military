// components/Navbar.jsx
import { Link } from "react-router-dom";
import logo from "../assets/logo.JPG";

export default function Navbar() {
  return (
    <nav style={styles.nav}>
      <Link to="/" style={styles.brandLink}>
        <div style={styles.brand}>
          <img src={logo} alt="Logo" style={styles.logoImg} />
          <span style={styles.logoText}>الكلية السلطان قابوس العسكرية</span>
        </div>
      </Link>

      <ul style={styles.menu}>
        <li>
          <Link to="/" style={styles.link} className="nav-link">الرئيسية</Link>
        </li>
        <li>
          <Link to="/about" style={styles.link} className="nav-link">عن الكلية</Link>
        </li>
        <li>
          <Link to="/academics" style={styles.link} className="nav-link">الشؤون الأكاديمية</Link>
        </li>
        <li>
          <Link to="/services" style={styles.link} className="nav-link">خدمات الطلبة</Link>
        </li>
        <li>
          <Link to="/research" style={styles.link} className="nav-link">البحث العلمي</Link>
        </li>
        <li>
          <Link to="/media" style={styles.link} className="nav-link">المركز الإعلامي</Link>
        </li>
      </ul>
      <style>{linkHoverStyle}</style>
    </nav>
  );
}

const styles = {
  nav: {
    background: "#fff",
    padding: "15px 40px",
    display: "flex",
    alignItems: "center",
    gap: "30px",
    boxShadow: "0 2px 10px rgba(0,0,0,0.08)"
  },

  brandLink: {
    textDecoration: "none",
    color: "inherit"
  },

  brand: {
    display: "flex",
    alignItems: "center",
    gap: "12px"
  },

  logoImg: {
    height: "45px",
    width: "auto"
  },

  logoText: {
    fontWeight: "bold",
    fontSize: "18px"
  },

  menu: {
    listStyle: "none",
    display: "flex",
    gap: "25px",
    margin: 0,
    padding: 0
  },

  link: {
    textDecoration: "none",
    color: "#333",
    fontSize: "16px",
    fontWeight: "500",
    transition: "color 0.2s ease",
    cursor: "pointer",
    padding: "5px 0",
    position: "relative"
  }
};

// Add hover effect via CSS
const linkHoverStyle = `
  .nav-link:hover {
    color: var(--primary) !important;
  }
  .nav-link::after {
    content: '';
    position: absolute;
    bottom: 0;
    right: 0;
    width: 0;
    height: 2px;
    background: var(--primary);
    transition: width 0.3s ease;
  }
  .nav-link:hover::after {
    width: 100%;
  }
`;
