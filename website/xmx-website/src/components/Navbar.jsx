import { NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import logo from "../assets/logo.JPG";
import "./Navbar.css";

const navItems = [
  { to: "/", label: "الرئيسية" },
  { to: "/about", label: "عن الكلية" },
  { to: "/academics", label: "الشؤون الأكاديمية" },
  { to: "/services", label: "خدمات الطلبة" },
  { to: "/research", label: "البحث العلمي" },
  { to: "/media", label: "المركز الإعلامي" },
];

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav className={`navbar ${isScrolled ? "scrolled" : ""}`}>
      <div className="navbar-brand">
        <NavLink to="/" className="brand-link" onClick={() => setIsOpen(false)}>
          <img src={logo} alt="شعار الكلية" className="brand-logo" />
          <span className="brand-text">كلية السلطان قابوس العسكرية</span>
        </NavLink>
        <button
          className={`nav-toggle ${isOpen ? "open" : ""}`}
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label="Toggle navigation"
          aria-expanded={isOpen}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      <ul className={`nav-menu ${isOpen ? "open" : ""}`}>
        {navItems.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                `nav-link ${isActive ? "active" : ""}`
              }
              onClick={() => setIsOpen(false)}
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
