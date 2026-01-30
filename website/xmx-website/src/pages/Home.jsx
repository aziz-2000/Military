// pages/Home.jsx
import Navbar from "../components/Navbar";
import Hero from "../components/Hero";
import Commander from "../components/Commander";
import QuickLinks from "../components/QuickLinks";
import News from "../components/News";
import Footer from "../components/Footer";

export default function Home() {
  try {
    return (
      <>
        <Navbar />
        <Hero />
        <Commander />
        <QuickLinks />
        <News />
        <Footer />
      </>
    );
  } catch (error) {
    console.error("Error in Home component:", error);
    return (
      <div style={{ padding: "50px", textAlign: "center" }}>
        <h1>Error loading page</h1>
        <p>{error.message}</p>
      </div>
    );
  }
}
