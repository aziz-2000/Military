// src/components/News.jsx
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import { FaChevronRight, FaChevronLeft } from "react-icons/fa";

const NEWS = [
  {
    id: 1,
    source: "وكالة الأنباء العمانية",
    title: "كليةُ السُّلطان قابوس العسكرية تنفذ البيان العملي للضباط المرشحين (درع 30)",
    excerpt:
      "مسقط في 2 سبتمبر /العُمانية/ نفذت كليةُ السُّلطان قابوس العسكرية بأكاديمية الجيش السُّلطاني العُماني اليوم البيان العملي للتمرين النهائي (درع 30)...",
    date: "Sep 2, 2025",
    image:
      "https://images.unsplash.com/photo-1520975693416-35a7f1c6f7f3?auto=format&fit=crop&w=1200&q=60"
  },
  {
    id: 2,
    source: "Shabiba",
    title: "تسليم شهادات الدبلوم في العلوم العسكرية لدورة الضباط المرشحين المتخرجة",
    excerpt:
      "مسقط - سلم قائد الجيش السلطاني العماني اللواء الركن مطر بن سالم بن راشد البلوشي صباح أمس شهادات الدبلوم في العلوم العسكرية للضباط المرشحين بكلية السلطان...",
    date: "May 3, 2025",
    image:
      "https://images.unsplash.com/photo-1/529070538774-1843cb3265df?auto=format&fit=crop&w=1200&q=60"
  },
  {
    id: 3,
    source: "صحيفة الصحوة",
    title: "قائد الجيش السُّلطاني العُماني يُسلم البراءة السُّلطانية وشهادات التخرج لضباط الدورات المتخرجة",
    excerpt:
      "العمانية – سلّم اللواء الركن مطر بن سالم البلوشي قائد الجيش السُّلطاني العُماني بميدان الاستعراض العسكري بمعسكر شافع اليوم البراءة السُّلطانية...",
    date: "1 month ago",
    image:
      "https://images.unsplash.com/photol-1520965958225-2c2c156d3f73?auto=format&fit=crop&w=1200&q=60"
  },
  {
    id: 4,
    source: "قناة ومنصة المشهد",
    title: "صور - عمان شهدت حفل تخريج دورة الضباط المرشحين اليوم - المشهد",
    excerpt:
      "شهدت سلطنة عمان حفل تخريج دورة الضباط المرشحين اليوم في أجواء من السعادة والفرحة. تخريج دورة الضباط المرشحين اليوم في عمان واحتفل الجيش...",
    date: "1 month ago",
    image:
      "https://images.unsplash.com/photo-1520975869010-3f0d7d6e6f9c?auto=format&fit=crop&w=1200&q=60"
  },
  {
    id: 5,
    source: "Shabiba",
    title: "الجيش السلطاني يحتفل بتخريج دورة الضباط المرشحين",
    excerpt:
      "احتفل الجيش السلطاني العُماني صباح اليوم بتخريج دورة الضباط المرشحين، ودورة الضباط المرشحين من العنصر النسائي لأول مرة من كلية السلطان قابوس العسكرية، تحت...",
    date: "Apr 25, 2025",
    image:
      "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1200&q=60"
  },
  {
    id: 6,
    source: "جريدة عمان",
    title: "تخريج دورة الضباط المرشحين من كلية السلطان قابوس العسكرية",
    excerpt:
      "وقال المقدم الركن خالد بن راشد الشبلي من الجيش السلطاني العماني: \"تحتفل كلية السلطان قابوس العسكرية بتخريج كوكبة من حماة الوطن تم صقلهم وإعدادهم...\"",
    date: "Dec 21, 2022",
    image:
      "https://images.unsplash.com/dphoto-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=60"
  },
  {
    id: 7,
    source: "وكالة الأنباء العمانية",
    title: "كلية السُّلطان قابوس العسكرية تشرع في عملية تدقيق الجودة المؤسسية",
    excerpt:
      "مسقط في 10 مايو/ العُمانية/ شرعت كلية السُّلطان قابوس العسكرية بأكاديمية الجيش السُّلطاني العُماني في عملية تدقيق الجودة المؤسسية التي تقوم بها الهيئة العُمانية...",
    date: "May 10, 2022",
    image:
      "https://images.unsplash.com/dphoto-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1200&q=60"
  }
];

const styles = {
  sliderWrapper: {
    padding: "0 40px",
    position: "relative"
  },
  slideItem: {
    padding: "0 10px"
  },
  card: {
    background: "#fff",
    borderRadius: "14px",
    overflow: "hidden",
    boxShadow: "0 4px 12px rgba(0,0,0,0.10)",
    transition: "transform 200ms ease, box-shadow 200ms ease",
    cursor: "pointer"
  },
  imageWrap: {
    position: "relative",
    height: "170px",
    overflow: "hidden",
    background: "#eee"
  },
  image: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
    transform: "scale(1.02)",
    transition: "transform 250ms ease"
  },
  overlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.70)",
    color: "#fff",
    padding: "14px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    opacity: 0,
    transform: "translateY(8px)",
    transition: "opacity 200ms ease, transform 200ms ease"
  },
  meta: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px"
  },
  badge: {
    background: "rgba(181,155,42,0.95)",
    color: "#111",
    padding: "6px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    maxWidth: "70%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  },
  date: {
    fontSize: "12px",
    opacity: 0.9,
    whiteSpace: "nowrap"
  },
  excerpt: {
    margin: 0,
    fontSize: "13px",
    lineHeight: 1.8,
    opacity: 0.95,
    display: "-webkit-box",
    WebkitLineClamp: 4,
    WebkitBoxOrient: "vertical",
    overflow: "hidden"
  },
  title: {
    margin: 0,
    padding: "14px 14px 16px",
    fontSize: "15px",
    lineHeight: 1.7,
    color: "#111",
    height: "74px",
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical"
  },
  nextArrow: {
    position: "absolute",
    right: "-30px",
    top: "50%",
    transform: "translateY(-50%)",
    background: "var(--primary)",
    color: "#fff",
    border: "none",
    borderRadius: "50%",
    width: "40px",
    height: "40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    zIndex: 10,
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
    transition: "all 0.3s ease"
  },
  prevArrow: {
    position: "absolute",
    left: "-30px",
    top: "50%",
    transform: "translateY(-50%)",
    background: "var(--primary)",
    color: "#fff",
    border: "none",
    borderRadius: "50%",
    width: "40px",
    height: "40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    zIndex: 10,
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
    transition: "all 0.3s ease"
  }
};

function NextArrow({ onClick }) {
  return (
    <button style={styles.nextArrow} onClick={onClick} aria-label="التالي">
      <FaChevronRight />
    </button>
  );
}

function PrevArrow({ onClick }) {
  return (
    <button style={styles.prevArrow} onClick={onClick} aria-label="السابق">
      <FaChevronLeft />
    </button>
  );
}

export default function News() {
  const settings = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: 3,
    slidesToScroll: 1,
    autoplay: true,
    autoplaySpeed: 3000,
    pauseOnHover: true,
    nextArrow: <NextArrow />,
    prevArrow: <PrevArrow />,
    rtl: true,
    responsive: [
      {
        breakpoint: 1024,
        settings: {
          slidesToShow: 2,
          slidesToScroll: 1,
          autoplay: true,
          autoplaySpeed: 3000
        }
      },
      {
        breakpoint: 768,
        settings: {
          slidesToShow: 1,
          slidesToScroll: 1,
          autoplay: true,
          autoplaySpeed: 3000
        }
      }
    ]
  };

  return (
    <section className="container" style={{ marginTop: "60px", marginBottom: "40px" }}>
      <h2 style={{ color: "var(--primary)", marginBottom: 30 }}>الأخبار والفعاليات</h2>

      <div style={styles.sliderWrapper}>
        <Slider {...settings}>
          {NEWS.map((item) => (
            <div key={item.id} style={styles.slideItem}>
              <article style={styles.card} className="news-card">
                <div style={styles.imageWrap}>
                  <img src={item.image} alt={item.title} style={styles.image} />
                  <div style={styles.overlay} className="news-overlay">
                    <div style={styles.meta}>
                      <span style={styles.badge}>{item.source}</span>
                      <span style={styles.date}>{item.date}</span>
                    </div>
                    <p style={styles.excerpt}>{item.excerpt}</p>
                  </div>
                </div>

                <h3 style={styles.title} title={item.title}>
                  {item.title}
                </h3>
              </article>
            </div>
          ))}
        </Slider>
      </div>

      {/* Hover behavior (CSS) */}
      <style>{css}</style>
    </section>
  );
}

const css = `
  .news-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 10px 24px rgba(0,0,0,0.16);
  }
  .news-card:hover img {
    transform: scale(1.08);
  }
  .news-card:hover .news-overlay {
    opacity: 1;
    transform: translateY(0);
  }
  .slick-dots {
    bottom: -40px !important;
  }
  .slick-dots li button:before {
    color: var(--primary) !important;
    font-size: 12px !important;
  }
  .slick-dots li.slick-active button:before {
    color: var(--primary) !important;
  }
  .slick-next:before,
  .slick-prev:before {
    display: none;
  }
  .slick-arrow:hover {
    background: #9a8324 !important;
    transform: translateY(-50%) scale(1.1);
  }
`;
