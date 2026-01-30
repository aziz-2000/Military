export default function Footer() {
    return (
        <footer style={styles.footer}>
            <div style={styles.top}>
                <div style={styles.column}>
                    <h3 style={styles.title}>كلية السلطان قابوس العسكرية</h3>
                    <p style={styles.text}>
                        تعد كلية السلطان قابوس العسكرية بأكاديمية الجيش السلطاني العُماني (SAOA)
                        المؤسسة التدريبية الرائدة في سلطنة عمان لتأهيل الضباط المرشحين
                        قيادياً وأكاديمياً، بما يسهم في دعم القوات المسلحة وتحقيق
                        رؤية عُمان 2040.
                    </p>
                </div>

                <div style={styles.column}>
                    <h3 style={styles.title}>روابط سريعة</h3>
                    <ul style={styles.list}>
                        <li>عن الكلية</li>
                        <li>البحث العلمي</li>
                        <li>البرامج الأكاديمية</li>
                        <li>الأخبار</li>
                        <li>اتصل بنا</li>
                    </ul>
                </div>

                <div style={styles.column}>
                    <h3 style={styles.title}>معلومات التواصل</h3>
                    <p style={styles.text}>📍 سلطنة عُمان</p>
                    <p style={styles.text}>📞 +968 0000 0000</p>
                    <p style={styles.text}>✉ info.xxx..om</p>
                </div>
            </div>

            <div style={styles.bottom}>
                © {new Date().getFullYear()} الكلية السلطان قابوس العسكرية  — جميع الحقوق محفوظة
            </div>
        </footer>
    );
}

const styles = {
    footer: {
        marginTop: "80px",
        backgroundColor: "#1e1e1e",
        color: "#fff"
    },
    top: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
        gap: "40px",
        padding: "50px 10%"
    },
    column: {
        lineHeight: "1.8"
    },
    title: {
        marginBottom: "15px",
        color: "#b59b2a",
        fontSize: "18px"
    },
    text: {
        fontSize: "14px",
        color: "#ddd"
    },
    list: {
        listStyle: "none",
        padding: 0,
        margin: 0,
        fontSize: "14px",
        color: "#ddd"
    },
    bottom: {
        borderTop: "1px solid #333",
        textAlign: "center",
        padding: "15px",
        fontSize: "13px",
        color: "#aaa"
    }
};
