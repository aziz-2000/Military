// pages/Home.jsx
import Navbar from "../components/Navbar";
import Hero from "../components/Hero";
import Commander from "../components/Commander";
import QuickLinks from "../components/QuickLinks";
import News from "../components/News";
import Footer from "../components/Footer";

export default function Home() {
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
}
