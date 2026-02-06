import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import "./Services.css";

const categories = [
  { id: "all", label: "الكل" },
  { id: "portals", label: "البوابات" },
  { id: "admin", label: "الإدارة والتحكم" },
  { id: "academic", label: "أكاديمي" },
  { id: "medical", label: "طبي وصحي" },
  { id: "discipline", label: "الحضور والانضباط" },
  { id: "reports", label: "التقارير والتحليلات" },
  { id: "digital", label: "خدمات رقمية" },
];

const services = [
  {
    id: "admin-portal",
    title: "بوابة الإدارة",
    description: "لوحة تنفيذية شاملة لإدارة الكلية والقرارات العليا.",
    category: "portals",
    status: "متاح تجريبياً",
    tags: ["قيادة", "تحكم", "تقارير"],
    link: "/admin-portal",
  },
  {
    id: "instructor-portal",
    title: "بوابة المحاضر",
    description: "متابعة الطلاب والدرجات والرسائل والشكاوى.",
    category: "portals",
    status: "متاح تجريبياً",
    tags: ["محاضر", "درجات", "طلاب"],
    link: "/instructor-portal",
  },
  {
    id: "student-portal",
    title: "بوابة الضابط المرشح",
    description: "عرض الملف الشخصي والمواد والدرجات والطلبات.",
    category: "portals",
    status: "متاح",
    tags: ["مرشح", "ملف شخصي", "درجات"],
    link: "/student-portal",
  },
  {
    id: "upload-portal",
    title: "بوابة رفع البيانات",
    description: "استلام الوثائق والبيانات مع سجل تدقيق كامل.",
    category: "portals",
    status: "قيد التطوير",
    tags: ["أرشفة", "مرفقات", "صلاحيات"],
    link: "/upload-portal",
  },
  {
    id: "candidate-management",
    title: "إدارة بيانات الضباط المرشحين",
    description: "ملفات شخصية، الحالة الأكاديمية، والتاريخ الوظيفي.",
    category: "admin",
    status: "قيد التنفيذ",
    tags: ["مرشح", "تحديث بيانات"],
  },
  {
    id: "cohort-management",
    title: "إدارة الدورات والفصائل",
    description: "تنظيم الدورات والفصائل وتوزيع المرشحين.",
    category: "admin",
    status: "قيد التنفيذ",
    tags: ["دورات", "فصائل", "توزيع"],
  },
  {
    id: "permissions",
    title: "صلاحيات حسب الرتبة والدور",
    description: "تحكم دقيق بالأدوار: قائد، ضابط أعلى، محاضر.",
    category: "admin",
    status: "قيد التطوير",
    tags: ["صلاحيات", "رتب", "أدوار"],
  },
  {
    id: "grades",
    title: "إدخال ومتابعة الدرجات الأكاديمية",
    description: "تقييمات، متابعة الأداء، وتنبيهات أكاديمية.",
    category: "academic",
    status: "قيد التنفيذ",
    tags: ["درجات", "تقييم"],
  },
  {
    id: "courses",
    title: "المواد والخطط الدراسية",
    description: "إدارة المواد حسب الدورات والمسارات.",
    category: "academic",
    status: "قيد التنفيذ",
    tags: ["مواد", "مناهج"],
  },
  {
    id: "medical",
    title: "سجل الزيارات الطبية والتقارير الصحية",
    description: "حفظ الفحوصات والحالات الطبية بدقة.",
    category: "medical",
    status: "قيد التنفيذ",
    tags: ["طب", "فحوصات"],
  },
  {
    id: "medical-dashboard",
    title: "لوحة المتابعة الطبية الوقائية",
    description: "تحليل المخاطر والتنبيهات الصحية المبكرة.",
    category: "medical",
    status: "قيد التطوير",
    tags: ["وقاية", "تنبيهات"],
  },
  {
    id: "attendance",
    title: "الحضور والغياب والملخصات اليومية",
    description: "مراقبة الانضباط اليومي وتقارير الفصائل.",
    category: "discipline",
    status: "قيد التنفيذ",
    tags: ["حضور", "انضباط"],
  },
  {
    id: "discipline-alerts",
    title: "نظام الإنذارات والانضباط",
    description: "تنبيهات تلقائية عند تجاوز نسب الغياب.",
    category: "discipline",
    status: "قيد التطوير",
    tags: ["إنذارات", "سلوك"],
  },
  {
    id: "executive-dashboard",
    title: "لوحة القيادة التنفيذية",
    description: "مؤشرات عليا تشبه تقارير Superset.",
    category: "reports",
    status: "قيد التنفيذ",
    tags: ["تقارير", "KPIs", "تحليل"],
  },
  {
    id: "activity-reports",
    title: "ملخصات الأعمال والأنشطة والتقارير",
    description: "قراءة يومية للأعمال والإنجازات.",
    category: "reports",
    status: "قيد التنفيذ",
    tags: ["أنشطة", "ملخصات"],
  },
  {
    id: "documents",
    title: "نظام الملفات والوثائق",
    description: "أرشفة الوثائق مع صلاحيات وتنزيل آمن.",
    category: "digital",
    status: "قيد التطوير",
    tags: ["أرشفة", "ملفات"],
  },
  {
    id: "elearning",
    title: "التعليم الإلكتروني",
    description: "ربط المحتوى الرقمي والمحاضرات الإلكترونية.",
    category: "digital",
    status: "متاح لاحقاً",
    tags: ["تعليم", "Moodle"],
  },
  {
    id: "email",
    title: "البريد الإلكتروني الجامعي",
    description: "خدمة البريد الرسمية للمرشحين والموظفين.",
    category: "digital",
    status: "متاح لاحقاً",
    tags: ["بريد", "مراسلات"],
  },
  {
    id: "library",
    title: "مركز مصادر التعلم",
    description: "إتاحة المراجع والكتب الإلكترونية.",
    category: "digital",
    status: "متاح لاحقاً",
    tags: ["مكتبة", "مراجع"],
  },
  {
    id: "exams",
    title: "الاختبارات الإلكترونية",
    description: "اختبارات وتقويم إلكتروني آمن.",
    category: "digital",
    status: "متاح لاحقاً",
    tags: ["اختبارات", "تقويم"],
  },
  {
    id: "housing",
    title: "نظام الإعاشة",
    description: "إدارة الإعاشة والسكن والخدمات اللوجستية.",
    category: "digital",
    status: "متاح لاحقاً",
    tags: ["إعاشة", "سكن"],
  },
  {
    id: "it-services",
    title: "خدمات تقنية المعلومات",
    description: "طلبات الدعم الفني والصيانة.",
    category: "digital",
    status: "متاح لاحقاً",
    tags: ["دعم", "تقنية"],
  },
  {
    id: "rapid-response",
    title: "نظام الاستجابة السريعة",
    description: "قنوات البلاغات العاجلة والحالات الطارئة.",
    category: "digital",
    status: "متاح لاحقاً",
    tags: ["بلاغات", "طوارئ"],
  },
];

export default function Services() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  const filteredServices = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return services.filter((service) => {
      const matchesCategory =
        activeCategory === "all" || service.category === activeCategory;
      const matchesKeyword =
        !keyword ||
        service.title.toLowerCase().includes(keyword) ||
        service.description.toLowerCase().includes(keyword) ||
        service.tags.some((tag) => tag.toLowerCase().includes(keyword));
      return matchesCategory && matchesKeyword;
    });
  }, [search, activeCategory]);

  const statusCounts = useMemo(() => {
    return services.reduce(
      (acc, service) => {
        acc.total += 1;
        if (service.status.includes("متاح")) acc.available += 1;
        return acc;
      },
      { total: 0, available: 0 }
    );
  }, []);

  return (
    <>
      <Navbar />
      <div className="services-page">
        <section className="services-hero">
          <div>
            <h1>خدمات الطلبة والتحول الرقمي</h1>
            <p>
              منصة شاملة لخدمات الكلية العسكرية، مصممة لتقديم تجربة احترافية
              للقيادات والمرشحين والمحاضرين.
            </p>
            <div className="services-stats">
              <div>
                <span>إجمالي الخدمات</span>
                <strong>{statusCounts.total}</strong>
              </div>
              <div>
                <span>خدمات متاحة حالياً</span>
                <strong>{statusCounts.available}</strong>
              </div>
            </div>
          </div>
          <div className="services-highlight">
            <h3>أبرز ما تم تطويره</h3>
            <p>بوابات الإدارة والمحاضرين والمرشحين أصبحت تفاعلية الآن.</p>
            <Link to="/student-portal" className="primary-link">
              الدخول إلى بوابة المرشح
            </Link>
          </div>
        </section>

        <section className="services-controls">
          <div className="search-box">
            <input
              type="text"
              placeholder="ابحث عن خدمة أو قسم..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="category-pills">
            {categories.map((category) => (
              <button
                key={category.id}
                className={activeCategory === category.id ? "active" : ""}
                onClick={() => setActiveCategory(category.id)}
              >
                {category.label}
              </button>
            ))}
          </div>
        </section>

        <section className="services-grid">
          {filteredServices.length === 0 && (
            <div className="empty-state">لا توجد نتائج مطابقة.</div>
          )}
          {filteredServices.map((service) => (
            <div key={service.id} className="service-card">
              <div className="service-header">
                <h3>{service.title}</h3>
                <span className={`status ${service.status.includes("متاح") ? "available" : "pending"}`}>
                  {service.status}
                </span>
              </div>
              <p>{service.description}</p>
              <div className="tags">
                {service.tags.map((tag) => (
                  <span key={`${service.id}-${tag}`}>{tag}</span>
                ))}
              </div>
              {service.link && (
                <Link to={service.link} className="secondary-link">
                  الانتقال للخدمة
                </Link>
              )}
            </div>
          ))}
        </section>
      </div>
      <Footer />
    </>
  );
}
