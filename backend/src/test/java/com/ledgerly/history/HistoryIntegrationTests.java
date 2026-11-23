package com.ledgerly.history;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ledgerly.auth.UserAccountRepository;
import com.ledgerly.document.PurchaseDocumentRepository;
import com.ledgerly.receipt.ReceiptRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class HistoryIntegrationTests {
    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    UserAccountRepository users;

    @Autowired
    ReceiptRepository receipts;

    @Autowired
    PurchaseDocumentRepository documents;

    @Autowired
    HistoryEventRepository history;

    @BeforeEach
    void clearRepositories() {
        history.deleteAll();
        documents.deleteAll();
        receipts.deleteAll();
        users.deleteAll();
    }

    @Test
    void receiptCreateUpdateAndDeleteCreatePersistedHistory() throws Exception {
        MockHttpSession session = register();
        String receiptId = createReceipt(session);

        mockMvc.perform(patch("/api/receipts/" + receiptId)
                        .with(csrf())
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "merchantName":"Updated Store",
                                  "purchasedAt":"2026-11-18",
                                  "total":90.50,
                                  "category":"Shopping",
                                  "warrantyConfirmed":false
                                }
                                """))
                .andExpect(status().isOk());

        mockMvc.perform(delete("/api/receipts/" + receiptId).with(csrf()).session(session))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/history").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].eventType").value("RECEIPT_DELETED"))
                .andExpect(jsonPath("$[1].eventType").value("RECEIPT_UPDATED"))
                .andExpect(jsonPath("$[2].eventType").value("RECEIPT_CREATED"));
    }

    @Test
    void collectionAssignmentCreatesPersistedHistory() throws Exception {
        MockHttpSession session = register();
        String receiptId = createReceipt(session);

        MvcResult projectResult = mockMvc.perform(post("/api/projects")
                        .with(csrf())
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Home office","color":"blue"}
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        String projectId = objectMapper.readTree(projectResult.getResponse().getContentAsString())
                .get("id").asText();

        mockMvc.perform(patch("/api/projects/" + projectId + "/receipts/" + receiptId)
                        .with(csrf())
                        .session(session))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/history").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].eventType").value("COLLECTION_ASSIGNED"))
                .andExpect(jsonPath("$[0].description").value("Purchase assigned to collection Home office"));
    }

    private MockHttpSession register() throws Exception {
        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"history@example.com","displayName":"History User","password":"Password123"}
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        return (MockHttpSession) result.getRequest().getSession(false);
    }

    private String createReceipt(MockHttpSession session) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/receipts")
                        .with(csrf())
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "merchantName":"Target",
                                  "purchasedAt":"2026-11-18",
                                  "total":86.40,
                                  "category":"Shopping"
                                }
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText();
    }
}
