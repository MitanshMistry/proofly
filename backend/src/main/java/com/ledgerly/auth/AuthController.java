package com.ledgerly.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import com.ledgerly.receipt.ReceiptRepository;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.security.web.csrf.CsrfToken;
import com.ledgerly.project.ProjectRepository;
import com.ledgerly.storage.LocalReceiptStorage;
import com.ledgerly.document.PurchaseDocumentRepository;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final UserAccountRepository users;
    private final PasswordEncoder passwords;
    private final AuthenticationManager authenticationManager;
    private final ReceiptRepository receipts;
    private final ProjectRepository projects;
    private final LocalReceiptStorage storage;
    private final PurchaseDocumentRepository purchaseDocuments;

    public AuthController(UserAccountRepository users, PasswordEncoder passwords, AuthenticationManager authenticationManager,
                          ReceiptRepository receipts, ProjectRepository projects, LocalReceiptStorage storage,
                          PurchaseDocumentRepository purchaseDocuments) {
        this.users = users;
        this.passwords = passwords;
        this.authenticationManager = authenticationManager;
        this.receipts = receipts;
        this.projects = projects;
        this.storage = storage;
        this.purchaseDocuments = purchaseDocuments;
    }

    @GetMapping("/csrf")
    public java.util.Map<String, String> csrf(CsrfToken token) {
        return java.util.Map.of("headerName", token.getHeaderName(), "token", token.getToken());
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public AccountResponse register(@Valid @RequestBody RegisterRequest request, HttpServletRequest servletRequest) {
        String email = request.email().trim().toLowerCase();
        if (users.findByEmail(email).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "An account with that email already exists");
        }
        UserAccount account = users.save(new UserAccount(email, request.displayName().trim(), passwords.encode(request.password())));
        Authentication authentication = authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(email, request.password()));
        persistSession(authentication, servletRequest);
        return AccountResponse.from(account);
    }

    @PostMapping("/login")
    public AccountResponse login(@Valid @RequestBody LoginRequest request, HttpServletRequest servletRequest) {
        String email = request.email().trim().toLowerCase();
        Authentication authentication = authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(email, request.password()));
        persistSession(authentication, servletRequest);
        return AccountResponse.from((UserAccount) authentication.getPrincipal());
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest request) {
        request.getSession(false);
        SecurityContextHolder.clearContext();
        if (request.getSession(false) != null) {
            request.getSession(false).invalidate();
        }
    }

    @GetMapping("/me")
    public AccountResponse me() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated() || authentication.getPrincipal() instanceof String) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sign in required");
        }
        return AccountResponse.from((UserAccount) authentication.getPrincipal());
    }

    @DeleteMapping("/account")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteAccount(HttpServletRequest request) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof UserAccount account)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sign in required");
        }
        var ownedReceipts = receipts.findByUserIdOrderByPurchasedAtDesc(account.getId());
        ownedReceipts.forEach(receipt -> purchaseDocuments.findByReceiptId(receipt.getId()).forEach(document -> {
            purchaseDocuments.delete(document);
            storage.delete(document.getObjectKey());
        }));
        ownedReceipts.forEach(receipt -> storage.delete(receipt.getImageObjectKey()));
        ownedReceipts.forEach(receipts::delete);
        projects.findByUserIdOrderByCreatedAtDesc(account.getId()).forEach(projects::delete);
        users.delete(account);
        SecurityContextHolder.clearContext();
        if (request.getSession(false) != null) request.getSession(false).invalidate();
    }

    private void persistSession(Authentication authentication, HttpServletRequest request) {
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        request.getSession(true).setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, context);
    }

    public record RegisterRequest(@Email @NotBlank String email, @NotBlank @Size(max=120) String displayName,
                                  @Size(min=8,max=72) String password) {}
    public record LoginRequest(@Email @NotBlank String email, @Size(min=8,max=72) String password) {}
    public record AccountResponse(java.util.UUID id, String email, String displayName) {
        static AccountResponse from(UserAccount account) {
            return new AccountResponse(account.getId(), account.getUsername(), account.getDisplayName());
        }
    }
}
