import { A } from "@solidjs/router";
import { FiTrash2 } from "solid-icons/fi";
import { createResource, For, Show, startTransition } from "solid-js";
import { useAuth } from "~/lib/atproto/AuthContext";
import { deleteProject, listProjects } from "~/lib/atproto/records";
import styles from "./home.module.css";

export default function Home() {
  const { agent } = useAuth();

  const [projects, { refetch }] = createResource(
    () => agent(),
    async (currentAgent) => {
      if (!currentAgent) return [];
      return listProjects(currentAgent);
    },
  );

  async function handleDelete(uri: string, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    const currentAgent = agent();
    if (!currentAgent) return;
    if (!confirm("Delete this project?")) return;
    await deleteProject(currentAgent, uri);
    startTransition(() => refetch());
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString();
  };

  return (
    <div class={styles.container}>
      <div class={styles.hero}>
        <h1 class={styles.title}>Klip</h1>
        <p class={styles.subtitle}>
          A 4-track recorder for the AT Protocol era
        </p>
        <A href="/editor" class={styles.newProject}>
          New Project
        </A>
      </div>

      <Show when={agent() && projects()?.length}>
        <div class={styles.projectList}>
          <h2 class={styles.projectListTitle}>Your Projects</h2>
          <div class={styles.projectGrid}>
            <For each={projects()}>
              {(project) => (
                <A href={`/editor/${project.rkey}`} class={styles.projectCard}>
                  <div class={styles.projectTitle}>{project.title}</div>
                  <div class={styles.projectMeta}>
                    {project.trackCount} track
                    {project.trackCount !== 1 ? "s" : ""} ·{" "}
                    {formatDate(project.createdAt)}
                  </div>
                  <button
                    type="button"
                    class={styles.deleteButton}
                    onClick={(e) => handleDelete(project.uri, e)}
                  >
                    <FiTrash2 size={14} />
                  </button>
                </A>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
