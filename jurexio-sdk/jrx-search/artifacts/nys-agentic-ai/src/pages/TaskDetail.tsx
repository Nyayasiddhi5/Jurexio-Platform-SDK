import { useParams } from "wouter";
import { useGetTask, getGetTaskQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlayCircle, ArrowLeft, FileText, CheckSquare, Target } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: task, isLoading, isError } = useGetTask(Number(id), { 
    query: { enabled: !!id, queryKey: getGetTaskQueryKey(Number(id)) } 
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-12 w-3/4" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
          <div className="col-span-2 space-y-4">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !task) {
    return (
      <div className="text-center p-12">
        <h2 className="text-2xl font-serif mb-4">Task not found</h2>
        <Link href="/library">
          <Button variant="outline">Return to Library</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex items-center gap-2">
        <Link href="/library">
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
            <ArrowLeft className="w-4 h-4" />
            Back to Library
          </Button>
        </Link>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b pb-6">
        <div className="space-y-4 flex-1">
          <div className="flex items-center gap-3">
            <Badge className="bg-primary/10 text-primary hover:bg-primary/20">{task.categoryName}</Badge>
            <Badge variant="outline" className="capitalize">{task.workType}</Badge>
          </div>
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground leading-tight">{task.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {task.tags.map((tag, i) => (
              <span key={i} className="text-xs px-2.5 py-1 bg-muted rounded-md text-muted-foreground">{tag}</span>
            ))}
          </div>
        </div>
        <Link href={`/run/new?taskId=${task.id}`}>
          <Button size="lg" className="gap-2 flex-shrink-0">
            <PlayCircle className="w-5 h-5" />
            Run the Agent
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="col-span-2 space-y-8">
          <section className="space-y-4">
            <h2 className="text-2xl font-serif font-semibold flex items-center gap-2">
              <FileText className="w-6 h-6 text-muted-foreground" />
              Instructions
            </h2>
            <Card>
              <CardContent className="p-6 prose prose-slate max-w-none">
                <div className="whitespace-pre-wrap">{task.instructions}</div>
              </CardContent>
            </Card>
          </section>

          {task.documents && task.documents.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-2xl font-serif font-semibold">Reference Documents</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {task.documents.map((doc, i) => (
                  <Card key={i} className="bg-muted/30">
                    <CardContent className="p-4 flex items-center gap-3">
                      <FileText className="w-5 h-5 text-primary" />
                      <span className="text-sm font-medium">{doc}</span>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-4">
            <h2 className="text-2xl font-serif font-semibold flex items-center gap-2">
              <Target className="w-6 h-6 text-muted-foreground" />
              Grading Rubric
            </h2>
            <div className="space-y-4">
              {task.criteria.map((criterion, i) => (
                <Card key={criterion.id}>
                  <CardHeader className="py-4 bg-muted/20 border-b">
                    <CardTitle className="text-base font-semibold">
                      <span className="text-muted-foreground font-mono mr-2">{i + 1}.</span>
                      {criterion.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="py-4">
                    <p className="text-sm text-muted-foreground">{criterion.matchCriteria}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <Card className="border-t-4 border-t-primary shadow-sm sticky top-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckSquare className="w-5 h-5" />
                Deliverables
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {task.deliverables.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8 pt-6 border-t border-border">
                <Link href={`/run/new?taskId=${task.id}`}>
                  <Button className="w-full gap-2">
                    <PlayCircle className="w-4 h-4" />
                    Start Agent Run
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
