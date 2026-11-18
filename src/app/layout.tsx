import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CaptionMitra AI | Video Captions Made Easy",
  description: "Generate and translate video subtitles in Hindi, Marathi, Hinglish and English.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
