import frontdoor from "../assets/hero.jpg";

export default function Hero() {
  return (
    <section style={styles.hero}>
      <div style={styles.overlay}>
        <h1>كلية السلطان قابوس العسكرية</h1>
        <h3>العلم والعمل الجاد</h3>
        <h4>كن القائد</h4>
      </div>
    </section>
  );
}

const styles = {
  hero: {
    height: "400px",
    background: `url(${frontdoor}) center / cover no-repeat`,
    position: "relative"
  },
  overlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    color: "#fff",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    textAlign: "center"
  }
};
