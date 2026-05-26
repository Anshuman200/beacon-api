import Header from "@/components/Header";
import SeederFormLoader from "@/components/SeederFormLoader";

export default function Home() {
  return (
    <div className="flex flex-col min-h-dvh lg:h-dvh lg:overflow-hidden">
      <Header />
      <main className="flex-1 lg:min-h-0 lg:flex lg:flex-col">
        <SeederFormLoader />
      </main>
    </div>
  );
}
