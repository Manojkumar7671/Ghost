import tkinter as tk
from tkinter import ttk

def authenticate():
    user = username_entry.get()
    pwd = password_entry.get()
    if user == "admin" and pwd == "secret123":
        status_label.config(text="Login Successful", foreground="green")
    else:
        status_label.config(text="Login Failed", foreground="red")

root = tk.Tk()
root.title("Login Page")
root.geometry("350x250")
root.resizable(False, False)

main_frame = ttk.Frame(root, padding="20")
main_frame.pack(fill=tk.BOTH, expand=True)

ttk.Label(main_frame, text="Username:").pack(pady=5)
username_entry = ttk.Entry(main_frame)
username_entry.pack(pady=5)

ttk.Label(main_frame, text="Password:").pack(pady=5)
password_entry = ttk.Entry(main_frame, show="*")
password_entry.pack(pady=5)

login_button = ttk.Button(main_frame, text="Login", command=authenticate)
login_button.pack(pady=10)

status_label = ttk.Label(main_frame, text="")
status_label.pack(pady=5)

root.mainloop()