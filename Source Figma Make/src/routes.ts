import { createBrowserRouter } from "react-router";
import Layout from "@/components/Layout";
import Home from "@/pages/Home";
import Destinations from "@/pages/Destinations";
import Rooms from "@/pages/Rooms";
import RoomDetail from "@/pages/RoomDetail";
import About from "@/pages/About";
import Book from "@/pages/Book";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Home },
      { path: "destinations", Component: Destinations },
      { path: "rooms", Component: Rooms },
      { path: "rooms/:id", Component: RoomDetail },
      { path: "about", Component: About },
      { path: "book", Component: Book },
    ],
  },
]);
