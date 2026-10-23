import { useState } from "react";
import { useListTasks, useListCategories, getListTasksQueryKey, getListCategoriesQueryKey } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Search, ChevronRight, BookOpen, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useJurisdiction, isReserved, isAllJurisdictions, JURISDICTIONS, jurisdictionBadgeLabel, jurisdictionQueryParam } from "@/lib/jurisdiction";

export default function Library() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [workType, setWorkType] = useState<string>("all");
  const { jurisdiction } = useJurisdiction();
  const jurisdictionInfo = JURISDICTIONS.find((j) => j.code === jurisdiction);

  const jParam = jurisdictionQueryParam(jurisdiction);
  const { data: categories } = useListCategories(
    { jurisdiction: jParam },
    { query: { queryKey: getListCategoriesQueryKey({ jurisdiction: jParam }) } },
  );
  const { data: tasks, isLoading, isError } = useListTasks({
    jurisdiction: jParam,
    search: search || undefined,
    category: category !== "all" ? category : undefined,
    workType: workType !== "all" ? workType : undefined,
  }, { query: { queryKey: getListTasksQueryKey({ jurisdiction: jParam, search, category, workType }) } });

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-serif font-bold text-foreground">Task Library</h1>
        <p className="text-muted-foreground text-lg">
          Browse professional legal benchmark tasks across practice areas
          {jurisdiction === "ALL"
            ? " (India, United States, and global)."
            : ` for ${jurisdictionInfo?.label ?? jurisdiction}.`}
        </p>
      </div>

      {isReserved(jurisdiction) && (
        <div className="border border-dashed rounded-lg bg-card p-4 text-sm text-muted-foreground" data-testid="banner-jurisdiction-reserved">
          {jurisdictionInfo?.flag} {jurisdictionInfo?.label}-specific tasks are coming soon — showing the jurisdiction-neutral global benchmark for now. Switch to Any/All, India, or United States for live libraries.
        </div>
      )}
      {isAllJurisdictions(jurisdiction) && (
        <div className="border border-dashed rounded-lg bg-card p-4 text-sm text-muted-foreground" data-testid="banner-jurisdiction-all">
          Showing India, United States, and global benchmark tasks. Each row is tagged with its jurisdiction.
        </div>
      )}

      <Card className="bg-card shadow-sm border">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-5 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search tasks by title or instruction..." 
                className="pl-9 h-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="md:col-span-4">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="All Practice Areas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Practice Areas</SelectItem>
                  {categories?.map((cat) => (
                    <SelectItem key={cat.slug} value={cat.slug}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3">
              <Select value={workType} onValueChange={setWorkType}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="All Work Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Work Types</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="analyze">Analyze</SelectItem>
                  <SelectItem value="review">Review</SelectItem>
                  <SelectItem value="research">Research</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 animate-pulse">
          {[...Array(5)].map((_, i) => <div key={i} className="h-32 bg-muted rounded-lg border"></div>)}
        </div>
      ) : isError ? (
        <div className="text-center p-12 text-destructive border rounded-lg bg-destructive/5">
          <AlertCircle className="w-8 h-8 mx-auto mb-2" />
          <p>Failed to load tasks.</p>
        </div>
      ) : !tasks || tasks.length === 0 ? (
        <div className="text-center p-16 border rounded-lg bg-card">
          <BookOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-xl font-serif font-medium mb-2">No tasks found</h3>
          <p className="text-muted-foreground">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {tasks.map((task) => (
            <Link key={task.id} href={`/library/${task.id}`}>
              <Card className="group cursor-pointer hover:border-primary transition-colors">
                <CardContent className="p-6 flex items-center justify-between gap-6">
                  <div className="space-y-3 flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className="font-normal text-xs uppercase tracking-wider">{task.categoryName}</Badge>
                      <Badge variant="outline" className="font-normal text-xs capitalize">{task.workType}</Badge>
                      {isAllJurisdictions(jurisdiction) && (
                        <Badge variant="outline" className="font-normal text-xs">
                          {jurisdictionBadgeLabel(task.jurisdiction)}
                        </Badge>
                      )}
                    </div>
                    <h3 className="text-xl font-semibold group-hover:text-primary transition-colors truncate">{task.title}</h3>
                    <p className="text-muted-foreground line-clamp-2 text-sm max-w-4xl">{task.instructions}</p>
                    <div className="flex items-center gap-2 pt-1">
                      {task.tags.slice(0, 3).map((tag, i) => (
                        <span key={i} className="text-xs px-2 py-1 bg-muted rounded-md text-muted-foreground">{tag}</span>
                      ))}
                      {task.tags.length > 3 && (
                        <span className="text-xs text-muted-foreground">+{task.tags.length - 3} more</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground group-hover:text-primary flex-shrink-0" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
