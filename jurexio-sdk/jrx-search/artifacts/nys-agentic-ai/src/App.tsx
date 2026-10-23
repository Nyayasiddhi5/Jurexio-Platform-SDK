import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/Layout";
import { AuthGate } from "@/components/AuthGate";
import { JurisdictionProvider } from "@/lib/jurisdiction";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/Dashboard";
import Library from "@/pages/Library";
import TaskDetail from "@/pages/TaskDetail";
import NewRun from "@/pages/NewRun";
import Runs from "@/pages/Runs";
import RunDetail from "@/pages/RunDetail";
import CaselawSearch from "@/pages/CaselawSearch";
import CaseLookup from "@/pages/CaseLookup";
import CaseDetail from "@/pages/CaseDetail";
import LegalChat from "@/pages/LegalChat";
import CitationCheck from "@/pages/CitationCheck";
import Statutes from "@/pages/Statutes";
import IpcBnsCompare from "@/pages/IpcBnsCompare";
import Templates from "@/pages/Templates";
import ApiTester from "@/pages/ApiTester";
import ArchiveSearch from "@/pages/ArchiveSearch";
import PatraMitra from "@/pages/PatraMitra";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/library" component={Library} />
        <Route path="/library/:id" component={TaskDetail} />
        <Route path="/run/new" component={NewRun} />
        <Route path="/runs" component={Runs} />
        <Route path="/run/:id" component={RunDetail} />
        <Route path="/chat" component={LegalChat} />
        <Route path="/patra-mitra" component={PatraMitra} />
        <Route path="/caselaw" component={CaselawSearch} />
        <Route path="/case-lookup" component={CaseLookup} />
        <Route path="/case/:cnr" component={CaseDetail} />
        <Route path="/archive" component={ArchiveSearch} />
        <Route path="/citations" component={CitationCheck} />
        <Route path="/statutes" component={Statutes} />
        <Route path="/statutes/compare" component={IpcBnsCompare} />
        <Route path="/templates" component={Templates} />
        <Route path="/api-tester" component={ApiTester} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthGate>
            <JurisdictionProvider>
              <Router />
            </JurisdictionProvider>
          </AuthGate>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
