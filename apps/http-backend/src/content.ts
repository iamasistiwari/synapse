import express, { Router, Request, Response } from "express";
import {
  ContentType,
  noteValidator,
  tweetLinkValidator,
} from "@repo/common/type";
import { zod } from "@repo/common/type";
import { supabase } from "@repo/db/supabase";
import axios from "axios";
import { GetHash } from "./helpers/validation";
import fetchMeta from "./helpers/metadata";
import splitChunks from "./helpers/splitchunks";

interface EmbeddingsResponse {
  embeddings: number[];
}

const contentRouter: Router = express.Router();

contentRouter.post("/add", async (req: Request, res: Response) => {
  try {
    console.log("USER ID", req.userId);
    console.log("BODY", req.body);

    const body: ContentType = req.body;
    if (body.type === "Link" || body.type === "Tweet") {
      const validation = tweetLinkValidator.safeParse(body);
      if (!validation.success) {
        const errorss = validation.error.issues.map((issue) => issue.message);
        res.status(400).json({
          message: "Invalid payload",
          error: errorss.map((issue) => issue),
        });
        return;
      }

      const metadata = await fetchMeta(validation.data.url);
      if (!metadata) {
        res.status(400).json({
          message: "Something wrong with the url",
          error: "Cannot able to fetch the url",
        });
        return;
      }
      const userTitle = validation.data.title;
      const urlTitle = metadata.body.data.title;
      const urlDescription = metadata.body.data.description;
      const urlMetaData = `${userTitle} ${urlTitle} ${urlDescription}`;
      const chunks = splitChunks(urlMetaData);

      try {
        await supabase.rpc("start_transaction");
        const { data: Content, error: ContentError } = await supabase
          .from("Content")
          .insert([
            {
              userId: req.userId,
              type: validation.data.type,
              title: userTitle,
              url: validation.data.url,
              description: JSON.stringify(metadata.body.data),
            },
          ])
          .select("id")
          .single();
        console.log("BEFRE CONTen", ContentError);
        if (ContentError) throw new Error("Error while uploading Content");

        const tagsToInsert = validation.data.tags.map((tag) => ({
          title: tag,
          contentId: Content?.id,
        }));

        for (const tag of tagsToInsert) {
          await supabase
            .from("Tags")
            .delete()
            .eq("contentId", tag.contentId)
            .eq("title", tag.title);

          const { error } = await supabase.from("Tags").insert(tag);
          if (error) throw new Error("Error while uploading tags");
        }

        for (let i = 0; i < chunks.length; i++) {
          const data = {
            data: chunks[i],
          };
          const token = GetHash();
          const embeddingsResponse = await axios.get(
            `https://embeddings-server.ashishtiwari.net?token=${token}`,
            {
              data,
            }
          );
          const embeddings = embeddingsResponse.data as EmbeddingsResponse;
          const section = {
            userId: req.userId,
            content_id: Content.id,
            sections_content: chunks[i],
            embeddings: embeddings.embeddings,
            section_order: i + 1,
          };

          const { error: sectionError } = await supabase
            .from("Content_Sections")
            .insert([section]);

          if (sectionError) throw new Error("Error while uploading Embeddings");
        }
        await supabase.rpc("commit_transaction");
        res.status(200).json({
          message: "Successfull",
          error: "",
        });
        return;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : JSON.stringify(error);
        await supabase.rpc("rollback_transaction");
        res
          .status(400)
          .json({ message: "Transaction failed", error: errorMessage });
        return;
      }
    }
    if (body.type === "Note") {
      const validation = noteValidator.safeParse(body);
      if (!validation.success) {
        const errorss = validation.error.issues.map((issue) => issue.message);
        res.status(400).json({
          message: "Invalid payload",
          error: errorss.map((issue) => issue),
        });
        return;
      }
      try {
        await supabase.rpc("start_transaction");
        const { data: Content, error: ContentError } = await supabase
          .from("Content")
          .insert([
            {
              userId: req.userId,
              type: validation.data.type,
              title: validation.data.title,
              description: validation.data.description,
            },
          ])
          .select("id")
          .single();
        console.log("HERE 1", ContentError);
        if (ContentError) throw new Error(ContentError.message);

        const tagsToInsert = validation.data.tags.map((tag) => ({
          title: tag,
          contentId: Content?.id,
        }));

        const { data: Tags, error: TagError } = await supabase
          .from("Tags")
          .upsert(tagsToInsert, {
            onConflict: "title",
          });

        console.log("HERE 2", TagError);

        if (TagError) throw new Error(TagError.message);

        const parsedDescription = JSON.parse(validation.data.description);
        console.log("here is parseDescrip", parsedDescription);
        const chunks = splitChunks(
          `${validation.data.title} ${parsedDescription}`
        );
        // vector embeddings process
        for (let i = 0; i < chunks.length; i++) {
          const data = {
            data: chunks[i],
          };
          const token = GetHash();
          const embeddingsResponse = await axios.get(
            `https://embeddings-server.ashishtiwari.net?token=${token}`,
            {
              data,
            }
          );
          const embeddings = embeddingsResponse.data as EmbeddingsResponse;
          const section = {
            userId: req.userId,
            content_id: Content.id,
            sections_content: chunks[i],
            embeddings: embeddings.embeddings,
            section_order: i + 1,
          };

          const { error: sectionError } = await supabase
            .from("Content_Sections")
            .insert([section]);

          if (sectionError) throw new Error(sectionError?.message);
          await supabase.rpc("commit_transaction");

          res.status(200).json({
            message: "Successfull",
            error: "",
          });
          return;
        }
      } catch (error) {
        await supabase.rpc("rollback_transaction");
        res.status(400).json({ message: "Transaction failed", error: error });
        return;
      }
    } else {
      res.status(400).json({
        message: "Invalid payload",
        error: "Provide correct payload",
      });
      return;
    }
  } catch (error) {
    if (error instanceof zod.ZodError) {
      const errorss = error.issues.map((issue) => issue.message);
      res.status(400).json({
        message: "Invalid payload",
        error: errorss.map((issue) => issue),
      });
      return;
    }
    res.status(500).json("Something went wrong");
    return;
  }
});

contentRouter.post("/ask", async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const validation = zod
      .object({ data: zod.string().min(5) })
      .safeParse(data);
    if (!validation.success) throw new Error("Invalid response");
    console.log("ASK DATA", data);
    const token = GetHash();
    const embeddingsResponse = await axios.get(
      `https://embeddings-server.ashishtiwari.net?token=${token}`,
      {
        data,
      }
    );
    const embeddings = embeddingsResponse.data as EmbeddingsResponse;
    const queryEmbeddingVector = `[${embeddings.embeddings.join(",")}]`;
    const { data: matchingSections, error: MatchError } = await supabase.rpc(
      "match_filtered_sections",
      {
        query_embedding: queryEmbeddingVector,
        match_threshold: -0.9,
        match_int: 10,
        userid: req.userId,
      }
    );
    console.log("GET", data, "error", MatchError);

    if (MatchError) {
      res.status(400).json({
        message: "Failed with query embeddings",
        error: MatchError.details,
      });
    }
    res.status(200).json({
      message: matchingSections,
      error: "",
    });
    return;
  } catch (error) {
    error instanceof Error ? error.message : "Something went wrong";
    res.status(400).json({
      message: "Error",
      error: error,
    });
    return;
  }
});

contentRouter.get("/getall", async (req: Request, res: Response) => {
  const userId = req.userId;
  console.log("HERE CaME", userId)
  try {
    const { data: Contents, error: ContentError } = await supabase
      .from("Content")
      .select("*")
      .eq("userId", userId);

    if (ContentError) throw new Error("Error while fetching");
    const filteredContents = Contents.map(({ userId, ...rest }) => rest);

    res.status(200).json({
      content: filteredContents,
    });
    return;
  } catch (error) {
    error instanceof Error ? error.message : "Something went wrong";
    res.status(400).json({
      error,
    });
    return;
  }
});


contentRouter.get("/get/:contentId", async (req: Request, res: Response) => {
  const { contentId } = req.params;
  if (!contentId) {
    res.status(400).json({
      error: "Invalid content request",
    });
    return;
  }
  const userId = req.userId;
  try {
    const { data: Contents, error: ContentError } = await supabase
      .from("Content")
      .select("*")
      .eq("userId", userId)
      .eq("id", contentId)

    if (ContentError) throw new Error("Error while fetching");
    const filteredContents = Contents.map(({ userId, ...rest }) => rest);

    res.status(200).json({
      content: filteredContents,
    });
    return;
  } catch (error) {
    error instanceof Error ? error.message : "Something went wrong";
    res.status(400).json({
      error,
    });
    return;
  }
});

export default contentRouter;
