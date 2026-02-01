import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import HomeSimple from "./pages/HomeSimple";
import About from "./pages/About";
import Research from "./pages/Research";
import Academics from "./pages/Academics";
import Media from "./pages/Media";
import Services from "./pages/Services";
import Test from "./pages/Test";
import StudentPortal from "./components/studentPortal/StudentPortal";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/test" element={<Test />} />
        <Route path="/simple" element={<HomeSimple />} />
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/research" element={<Research />} />
        <Route path="/academics" element={<Academics />} />
        <Route path="/media" element={<Media />} />
        <Route path="/services" element={<Services />} />
        <Route path="/student-portal" element={<StudentPortal />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
